# Host daemon Phase 2 — design (TODO 7.4, not implemented)

Scoped 2026-09-20 following the same "design before code" precedent as 6.1
([HANDOUT-PROVIDERS-DROPIN.md](HANDOUT-PROVIDERS-DROPIN.md)). This is a design, not a
plan to implement without review — the risk here is materially higher than 6.1's
(a bug can take down every mesh on the host at once, not just one drop-in provider),
and Phase 1 (7.1/7.2) hasn't finished proving itself under real load yet.

## Where this sits today

Phase 1 (landed 2026-09-19, see [[project_single_daemon_migration]]) added one
host-level *supervisor* process (`mesh-inbox-host-supervisor.ts`) that walks the
mesh registry and runs one `mesh-inbox-watcher` per mesh — but each watched mesh
still gets its own **`mesh-inbox-server` child process** and its own port. Phase 1
cut the number of *supervisor* processes from N to 1; it did not touch the N
*server* processes. 7.4 is about that second cut: collapsing N `mesh-inbox-server`
processes into N in-process listeners inside one process.

## What `mesh-inbox-server.ts` actually looks like today (the real constraint)

The whole file (1608 lines) is structurally already close to "one function that
sets up one mesh": everything lives inside a single `async function main()`, with
no module-level singleton state *in this file* — `createRegistryForProfile`,
`createNotifyActRegistry()`, `createTpPtyPool(loaded, …)` etc. are all called fresh
inside `main()` and return per-call instances, not shared globals. That's the good
news — naively, this suggests calling something like `main(loaded)` N times in one
process, once per mesh, might already work with only a signature change.

It doesn't, for two concrete reasons found by actually reading the file, not by
assumption:

### 1. Fault isolation today relies on `process.exit()` — four call sites

```
mesh-inbox-server.ts:154   missing profile.layout            -> process.exit(1)
mesh-inbox-server.ts:1467  server "error" (e.g. EADDRINUSE)  -> process.exit(1)
mesh-inbox-server.ts:1601  SIGTERM handler, after cleanup     -> process.exit(0)
mesh-inbox-server.ts:1607  main().catch() (top-level, any     -> process.exit(1)
                             unhandled error in the whole
                             bootstrap/run)
```

Today this is *correct* — one process = one mesh, so "give up and let the
supervisor respawn me" is the right response to a fatal error. In a collapsed
process, every one of these is wrong as-is: a fatal error in *any one* mesh's
listener would `process.exit()` the whole process, taking every other mesh on the
host down with it. That's a severe regression from today's per-mesh isolation, not
a neutral refactor. Phase 2's real engineering content is converting each of these
into "tear down and mark-failed *this one mesh's* listener, log it, let the outer
per-mesh supervision loop (see below) decide whether/when to retry it" — never a
process-wide exit triggered by one mesh's fault.

### 2. Cross-mesh module-global state — found at least one real instance

`main()` calls `configureInboxTypingGate({ skip: profile.daemon?.skipTypingGate })`
(line 150), which sets a **module-level** `let profileSkipTypingGate` in
`packages/daemon/src/inject/compose-gate.ts`. Two meshes with different
`daemon.skipTypingGate` profile values, collapsed into one process, would silently
clobber each other's setting — whichever mesh's instance initializes last wins for
*all* meshes in that process, not just its own. This is exactly the class of bug
that would be invisible in single-mesh testing and only show up on a host running
≥2 meshes with different config — i.e. exactly this box (seatmesh/pia/zsign/
dc-agent already have different `daemon.skipTypingGate`/`ux` config in practice).

**This was found by checking one function's dependencies, not an exhaustive
audit.** A real Phase 2 attempt needs to grep every module `mesh-inbox-server.ts`
transitively imports for `^let ` / `^const .* = new Map/Set` at module scope and
either (a) confirm it's truly immutable/read-only config, or (b) thread it through
as per-instance state instead. Not done here — flagging the pattern and one
concrete example, not claiming completeness.

## Proposed shape (not started)

- **`MeshInstance`** — wrap today's `main()` body into something re-instantiable:
  takes a `LoadedProfile` instead of reading `process.argv`/calling `loadProfile()`
  itself, owns its own `http.Server` bound to its own port (Node has no problem
  running many independent `http.Server`s in one process — "shared HTTP server
  dispatch by port/session" from 7.4's original one-line framing turns out to be
  unnecessary complexity; N ports, N servers, 1 process is simpler and preserves
  today's per-mesh port model operators/firewalls already expect), and exposes
  `stop(reason)` that tears down *only* its own timers/server/store, never touches
  `process`.
- **Host process** — replaces `mesh-inbox-host-supervisor.ts`'s current
  "spawn/watch a child `mesh-inbox-watcher.js` per mesh" with "construct/own a
  `MeshInstance` per mesh in-process." Health-rescue (today: SIGKILL the child PID)
  becomes "call `instance.stop("wedged")` then `new MeshInstance(loaded).start()`"
  — same rescue *semantics*, no OS-level process kill. 7.6's wedge-snapshot capture
  (`wedge-diagnostics.ts`) is unaffected either way — it doesn't care whether the
  thing being rescued is a child process or an in-process instance.
- **HMR** — today: stat the bundle, SIGTERM the child, let the supervisor respawn
  it with the freshly-built code (a real process restart re-executes the updated
  `require`/`import` graph for free). In-process, there is no free relaunch — an
  HMR "restart" would need to actually re-`import()` the changed module(s), which
  Node's module cache makes non-trivial (would need cache-busting query params or
  `vm` module tricks) or fall back to "the whole host process restarts on any
  mesh's HMR trigger," which reintroduces the every-mesh-affected-by-one-mesh's-
  change problem in a different place. **Not solved here** — this is probably the
  single biggest open question in this design, bigger than the two points above.

## Recommendation

Do not start implementation. Three concrete reasons, not just caution for its own
sake:

1. **7.2 (prove Phase 1) is still in progress**, not concluded — 7.4 was always
   sequenced after it in this TODO, and that sequencing is right: Phase 1's own
   health-rescue/HMR paths haven't accumulated real multi-day evidence yet
   (clock only started 2026-09-20, see 7.2). Building Phase 2 on top of an
   unproven Phase 1 compounds risk instead of isolating it.
2. **The module-global audit above is not complete.** One real cross-mesh
   contamination bug was found by reading one function's direct dependency; the
   actual transitive dependency graph of `mesh-inbox-server.ts` is large
   (connectivity, ACT registry, pty pool, ux-wrap, border-repaint, …) and hasn't
   been checked exhaustively.
3. **HMR has no answer yet**, and it's not a small gap — it's the mechanism that
   currently makes `npm run build` + supervised-restart the normal, safe way this
   whole codebase iterates on itself (see the "routine rebuilding restarts every
   live daemon" behavior documented in [[project_daemon_reliability_gap]]). Shipping
   Phase 2 without solving it either breaks HMR's isolation property or breaks HMR
   entirely for a collapsed host — both are regressions worth designing properly,
   not improvising under time pressure.

## Proposed TODO.md breakdown (not started)

- **7.4a** — module-global audit: enumerate every `let`/mutable module-scope
  binding transitively reachable from `mesh-inbox-server.ts`'s `main()`, classify
  each as read-only-safe or needs-per-instance-threading.
- **7.4b** — `MeshInstance` extraction: `main()` body becomes a class/factory
  taking `LoadedProfile`, with `start()`/`stop(reason)`, all four `process.exit()`
  call sites converted to instance-scoped failure signaling.
- **7.4c** — host-process integration: `mesh-inbox-host-supervisor.ts` owns
  `MeshInstance`s directly instead of spawning `mesh-inbox-watcher` children;
  health-rescue path adapted (kill-instance instead of SIGKILL-pid).
- **7.4d** — HMR redesign: the open question above, needs its own design pass
  once 7.4a-c exist to design against.

Do not implement 7.4a+ without confirming this design with the operator first —
same bar as 6.1's design doc, and for the same reason: this one's blast radius is
every live mesh on the host at once, not one drop-in provider.

# seatmesh NOW

**Updated:** 2026-09-19

**Design NOW:** open agent kinds — providers emit `kindBase` / `kindExtensions`.
CPE OpenCode = kind **`opencode-cpe`** (`extends: opencode`). Legacy name `oc-proxy`
is a normalize alias — **config that still says `oc-proxy` must keep working**.

**Migration CLOSED** when: (1) pia/zsign `providers`/`runners`/`cli: oc-proxy` launch CPE,
(2) four atomics record→kill→revive→CONTINUE work (`scripts/opencode-cpe-atomics.sh` /
`oc-proxy-atomics.sh` shim).

**Read:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [TODO.md](TODO.md) P6

## Done

- Open kinds + prove/satisfy/recovery (`1.2.4`)
- Canonical CPE kind rename: `opencode-cpe` (oc-proxy alias only)
- **oc-proxy config compat + 4 atomics proved** (stamp path aligned; type `opencode-cpe`|
  `oc-proxy` both selected)
- `1.2.5` — CLI declares `yaml` (npx/global)
- **Suite stabilized (2026-09-19)** — `npm run test:ci` was 15 failing tests / 12 files
  (stale `seatmesh agent` → `sm agent` fixtures, `triage-inject` never re-exported from
  `@seat-mesh/core`, OC composer stale-vs-live limit/credit ordering, `ack-redirect-block`
  over-matching PROVED/DONE as redirectable, `--agents help` shim arg-parse bug). All 141
  files green now; see git log for the individual fixes.
- **`test/docker`** — isolated CI runner (build+typecheck+vitest in a container, source
  COPYed not bind-mounted, no host tmux/mesh state touched). Also caught a real bug: root
  `build` script built `@seat-mesh/tmux` before `@seat-mesh/connectivity` even though
  `tmux/src/smoke-test.ts` imports it — worked on host only because stale `dist/` was
  already lying around. Fixed the declared dep + build order.

## Direction (2026-09-18)

**Single host daemon** — stop N× mesh-inbox (pia/zsign/seatmesh each supervisor+server).
Today is federation (ports + remotes + `/tmp` CPE stamps + sessions.json + hub :3190).
Herdr already owns “agent status” (idle/working/blocked) better; we should not keep
growing that surface inside every mesh-inbox.

**Do not reinvent Herdr.** Seatmesh keep: seats, contracts/supervise, peer/ack/cb,
enqueue-only inject, CPE atomics. Daemon slim toward: one process (or one supervisor
over N listeners), per-mesh queue isolation, drop duplicate status/scrape theater.

**Phase 1 landed (2026-09-19) — opt-in, not default.** `seatmesh host up|down|status`:
one `mesh-inbox-host-supervisor.js` process walks `~/.config/seatmesh/sessions.json`
and runs a `mesh-inbox-watcher` (spawn/health/HMR/crash-restart) per registered mesh,
instead of each mesh's own `ensureMeshInbox` spawning an independent
`mesh-inbox-supervisor.js`. Still N `mesh-inbox-server` processes / N ports — this
phase only consolidates the *supervisor* loops (1 health-watch + 1 HMR-poll instead
of N of each). Rescans the registry every 5s (`MESH_HOST_SUPERVISOR_RESCAN_MS`):
newly-registered meshes get a watcher, de-registered ones get torn down.

- `packages/daemon/src/mesh-inbox-watcher.ts` — extracted per-mesh state machine
  (`createMeshWatcher`), same meta/log shape as before — existing tooling
  (`readMeshInboxMeta`, `seatmesh inbox`, `/health`) doesn't care which supervisor
  started a child.
- `packages/daemon/src/mesh-inbox-host-supervisor.ts` — the host entry; per-mesh diff
  logic is pure/tested in `daemon/src/host/registry-diff.ts`.
- `mesh-inbox-supervisor.ts` (single-profile) is now a thin wrapper over the same
  watcher — unchanged behavior, still what `ensureMeshInbox` spawns by default.
- Smoke-tested end-to-end against two throwaway meshes under an isolated
  `XDG_CONFIG_HOME` (never touched the real `~/.config/seatmesh/`): `host up` spawns
  both, `host status` shows live pids/ports, de-registering one tears down just that
  one, `host down` cleans up both.

**Not yet done (phase 2+):** wire `host up` into `seatmesh start`/`engine` as the
default (currently opt-in only — pia/zsign/other live meshes on this box are
untouched until an operator explicitly switches over); collapse to N inject
consumers *inside* one process (today's phase keeps them as separate child
processes/ports); retire the per-mesh `ensureMeshInbox` spawn path once host mode
is proven under real multi-day load.

## Lab (upgrade / poke — not host meshes)

Isolated Docker lab so `npm i -g seatmesh` / `sm update` does not pop live
pia/zsign sessions:

```bash
cd test/lab && ./lab.sh up          # SSH :2222  inbox :31691
./lab.sh ssh                        # or password lab / seatmesh-lab
./lab.sh upgrade latest             # upgrade drill inside only
./lab.sh wipe                       # destroy lab volume only
```

Note: published `seatmesh` still lists `file:../` workspace deps — plain
`npm i -g seatmesh` is broken outside the monorepo. Lab `upgrade` rewrites
those deps. Default lab mode uses the bind-mounted repo bin.

## test/docker (CI runner — not the lab above)

Isolated container for build/typecheck/vitest on THIS checkout. Different job than
the lab: lab drills `npm i -g seatmesh` upgrades against a fake mesh; this runs the
actual test suite with no host tmux/mesh coupling (source is COPYed into the image).

```bash
npm run test:docker                 # == ./test/docker/run.sh test → build + test:ci
./test/docker/run.sh ci             # build + typecheck (not web) + test:ci
./test/docker/run.sh test:all       # vitest run, incl. sqlite-store.test.ts
./test/docker/run.sh shell          # interactive bash in the built image
```

## Next

1. **Single daemon (phase 2)** — prove `host up` under real multi-day load (this box:
   seatmesh/pia/zsign/dc-agent), then default `ensureMeshInbox` to it and retire the
   per-mesh spawn path. Phase 1 (host-level supervisor, opt-in) landed 2026-09-19.
2. **Slim tick** — split CPE/connectivity host sidecar if it keeps wedging `/health`
3. **P6.1** `.sm/providers/` drop-in (Kimi without fork)
4. **P6.2** `sm kind list|show`
5. Delete `origin/oc-proxy` git branch when meshes no longer need the alias story

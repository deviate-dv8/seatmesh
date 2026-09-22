# seatmesh TODO — harness parity (incremental)

**Canonical tracker.** Agents: read this before touching `seatmesh/`. Update checkboxes every slice.

| File | Job |
|------|-----|
| **TODO.md** (this) | Full parity checklist vs `legacy harness.sh` |
| **tasks/seatmesh/IMPLEMENT-CHECK.md** | **Impl + mini review + smoke** per item (slot-2 style) |
| **NOW.md** | Current slice only — what we're doing *this* turn |
| **README.md** | Handout + high-level status |
| **docs/** | Architecture / parallel / comms (not a task list) |

**Harness reference:** `legacy harness.sh` → `usage()` (~lines 51–187).

**Rules:** `sm` ≠ harness plugin. Code in `seatmesh/packages/*` only. Do **not** write `tmux-main-agents.json` from sm (read-only seed until `mesh-agents.json` exists).

**Status:** `[x]` done · `[~]` partial · `[ ]` not started · `[-]` defer

---

## P0 — broken / unusable

- [x] **0.1** `list-panes -s` bug — labeled whole session as minis → `window-panes.ts`
- [x] **0.2** 3×2 workers + 4×2 minis layout → equal `select-layout` grid (`layoutWorkers3x2` / `layoutMinis4x2`; `sm layout` fixes live session)
- [x] **0.3** `@mesh_*` labels + border strip → `labels.ts`, `borders.ts`
- [x] **0.4** Launch CLIs on session up → `launch.ts` + `agent-builder.ts` (reads harness JSON read-only)
- [x] **0.4b** Pane env before CLI → `session-env.ts` (NO_COLOR scrub); OC plain launch (CPE scripts optional/config-only)
- [x] **0.5** `sm verify`
- [x] **0.6** `sm labels`

---

## P1 — daily harness feel

- [x] **1.1** `whoami` — role YAML POV map + `sm whoami --validate` + init templates
- [x] **1.2** `manager`
- [x] **1.3** `prompt` / `prompt --manager` — enqueue PEER.jsonl; daemon inject (handoff/mini spawn still direct)
- [x] **1.4** `flush` — `flush.ts` (Enter rescue / Esc stuck draft)
- [x] **1.5** `switch` / `handoff` — relaunch + FOCUS handoff (`switch.ts`)
- [x] **1.6** `set` / `tag` — persist type/resumeId to `mesh-agents.json` (`set-tag.ts`; JSON only, no relaunch)
- [x] **1.7** `save` / `auto` — scrape + summary + labels; mini-pane refuse; secretary wanted persist
- [x] **1.8** `title` / `status` — `@mesh_title` / `@mesh_status` + border
- [x] **1.9** `remind` — manager-only; enqueue PEER.jsonl (`remind.ts`)
- [x] **1.10** `continue` + `night` — manager-only; flag `.sm/seats/manager/night.on` + peer enqueue
- [x] **1.11** `slot-advice` — `roles/slot-advice.ts`; manager-only; `--send` enqueues SLOT-ADVICE peer
- [x] **1.12** `providers list|scan`
- [x] **1.13** `peek <target> status|full` — `roles/peek.ts`; operator 23:29; mini review pending

---

## P2 — inbox / comms

- [~] **2.1** mesh inbox daemon (`mesh-inbox-server.ts` **:3100** — `JsonlStore` + `mesh-orchestrator` + `border-paint`; BullMQ when Redis reachable, poll fallback). Health wedge fixed (2.1e); list/resolve CLI parity still open (see **5.2**)
- [x] **2.2** `to-master` — enqueue + daemon inject (`deliverToPane`, `INBOX.jsonl` drain)
- [~] **2.3** peer comms — `sm to-slot` / `to-mini` enqueue `PEER.jsonl`; room/chat ledger separate
- [x] **2.4** `checkback` — `start|list|cancel|reset|ack` (`patience` alias) + auto-start on down via `ensureMeshInbox`
- [x] **2.5** `schedule` — `sm schedule <target> "<msg...>" --at <time>`, delayed one-shot peer (ISO time or relative duration). Queues via the normal `/to-peer` path but held out of drain (`PeerRow.notBefore`) until due; no ACK opens until actually delivered (fire-and-forget by design).
- [ ] **2.6** `dc-feedback` — operator's own call (2026-09-19): leave in the backlog, not now.

**Hard rule:** only daemon calls `inject.ts`.

---

## P3 — manager / secretary / minis

- [x] **3.1** `secretary start|stop|…` — `start`, `restart`, `switch`, `dispatch`, `collect`, `status`, `watch`, `supervise` already existed; added `stop` (switch secretary → empty, same path as `switch <target> empty`)
- [~] **3.2** `mini list|spawn|prompt|done|dispatch-all` + `secretary dispatch` (`minis.ts`)
- [x] **3.3** minis grid + leads from profile (`layout.minis.grid` / `max` / `leads`, `sm layout`)
- [-] **3.4** `triage` / `board-sync` — optional thin wrapper
- [x] **3.5** `contexts` / `seats` — `contexts.ts` (FOCUS preview + open TASK/REMINDER counts, `--json`)
- [x] **3.6** `nav log|summary` — navigation history for `peek <target>` (not switch/attach/pane-resume — those are provisioning, not pure navigation). `log` = chronological, `summary` = grouped by target with visit counts, most-recent first.
- [-] **3.7** `manager-reminder`
- [~] **3.8** `proxy` — status/check only

---

## P4 — cutover (see `docs/SURPASS.md`)

`docs/SURPASS.md` does not exist in this repo, and neither does `legacy harness.sh`
or anything on `:3099` (checked 2026-09-19) — 4.5/4.6's "surpass gate" framing
(beating the old bash harness) looks fully obsolete. Leaving unchecked rather than
guessing a replacement scope.

- [~] **4.1** `mesh-agents.json` (mesh-owned state) — save/read + set/tag + switch auto-save; full json engine still open
- [x] **4.2** `session down` (never touch `dev`) — already landed (`sessionDown`/`session down|stop|kill`); kills only `loaded.sessionName`, the current profile's own computed session — a session by any other name (e.g. `dev`) is structurally untouched, no special-case needed.
- [ ] **4.3** kiro trust dialog on launch — needs a real kiro-cli launch to verify against; not attempted without live-CLI access to confirm the fix actually works.
- [ ] **4.4** Cursor composer-ready wait before handoff — same: needs a real cursor-agent pane to verify timing against, not guessed.
- [-] **4.5** cutover doc: when workers leave `dev` — **surpass gate D**. Closed as
  defer, not open work: `docs/SURPASS.md` and `legacy harness.sh` don't exist in this
  repo, confirmed 2026-09-19 — the "surpass gate" framing this item is built on is
  gone, there's no replacement scope to guess at without inventing one unasked.
- [-] **4.6** **Surpass gate A** — inbox list/resolve + fix :3100 health wedge (beats
  harness :3099 for manager ops). Same closure as 4.5 — the harness/`:3099` this was
  scored against doesn't exist here; `inbox list/resolve` itself already shipped as
  5.2, so the only un-landed part of this item was the "beat :3099" framing, not a
  real gap.

---

## P5 — brainstorm backlog (aggregated in `tasks/seatmesh/docs/SM-FUNCTIONS.md`, mini-8 synth)

Open rows from the sm-functions campaign. Each ships as one function per SPEC (SMFUNCTIONS-SPEC.md) and gets a ONE-PATH.md row.

- [x] **5.1** `checkback start` — harness shape `start <duration> --expect "topic" [--renew] [--here|--slot|--mini]` + loud-fail inbox down
- [x] **5.2** `inbox list|resolve` + status `--wait|--meta` + `log|instances` — daemon routes + CLI (`inbox-bridge.ts`)
- [x] **5.3** `tag` — `set`/`tag` + `self`/`--auto` resume extract (`resume-extract.ts` + mesh-agents write)
- [x] **5.4** `seat mark|task|remind` — FOCUS/TASKS/REMINDER writes via `seat-update.ts` + CLI (`seat-cli.ts`); snapshot wrap in `readSeatSnapshot`
- [x] **5.5** `whoami --json` (P1-3)
- [x] **5.6** workers layout profile-config — `layoutWorkersFromProfile` replaces hard-coded `layoutWorkers3x2` (DAN req; P1-4). Verified done while scoping other work: wired into both `session.ts` call sites, `layoutWorkers3x2`/`layoutGrid` have zero live callers left outside tests.
- [x] **5.7** `notify` — `sm notify "<session>" "<check>" [--url URL]`, seat from TMUX_PANE, loud FAIL on missing notify-send (P2-1)
- [x] **5.8** `preview` — `sm preview <file...> [--set <days>] [--notify]` wrapping publish-mdview.sh (P2-3)
- [-] **5.9** `worktree` — `sm worktree new|rm|backlog <slug>` wrapping the three scripts (P2-4). Checked 2026-09-19: no such scripts anywhere in this repo — premise looks stale/inapplicable to seatmesh itself (may be a zsign-consumer-repo item). Needs re-spec before picking up.
- [x] **5.10** `room say` dedupe window + `cb=<id>` output; `room tail` id/pane/truncate + `--json`; `room get <id>` (P3-1/P3-2)
- [x] **5.11** `chat put|get` — positional upsert + id/turnHash lookup (P3-3)
- [~] **5.12** base layer `pane-meta|panes|capture|inject|interrupt|restart` — surface tmux primitives as verbs (P4-2). `pane-meta`/`panes` already landed (see `pane-meta-cli.ts` "P4-2" comment). **`capture` landed 2026-09-19**: `sm capture [target] [--lines N] [--ansi] [--json]` (`pane-capture-cli.ts`) — read-only scrollback dump, reuses `capturePaneSnapshot`'s cached tail by default or a fresh raw `tmux capture-pane -S -N` when `--lines` overrides the default 80. Never writes to a pane, so it doesn't touch "No direct send." 7 unit tests + live-verified against a real tmux pane's captured content. `inject`/`interrupt`/`restart` as raw CLI primitives would still contradict "No direct send" in ARCHITECTURE.md — the daemon is supposed to be the *only* pane writer — and remain deliberately not implemented.

---

## P6 — agent kinds (open registry / no-fork CLIs)

Landed on `agent-kinds-json` → `1.2.4`: provider `kindBase`/`kindExtensions`, `agents.kinds` overlay,
prove/satisfy/recovery, open `type` strings. CPE = `opencode-cpe` **extends** `opencode`.

- [x] **6.1** **`.sm/providers/` load** — drop-in provider modules (e.g. `kimi.mjs`) without engine PR/fork; register into builtin registry + emit `kindBase`. Today: launch-only via `agents.kinds`; full inject still needs a provider class in `@seat-mesh/providers` (or this loader). See [docs/HANDOUT-PROVIDERS-DROPIN.md](docs/HANDOUT-PROVIDERS-DROPIN.md): `.mjs` file contract, error-isolation wrapper (a throwing/hanging drop-in provider must not take the shared daemon down), and why Phase 1 is daemon-registry-only (`resolveKindsForProfile`/`createRegistryForProfile` are sync and have ~30+ call sites — making them async to support this would be a much bigger refactor than the feature is worth). Broken into 6.1a (loader+validation+wrapper, landed 2026-09-19) / 6.1b (wire into
  daemon bootstrap only, landed 2026-09-19 — inject-capable drop-in providers now
  work for real, no PR/fork needed; still requires the `agents.kinds` yaml stanza
  from EXAMPLE-CUSTOM-KIND-KIMI.md too, per the design's Phase-1 scope) / **6.1c
  landed 2026-09-20**: kind auto-merge, the yaml stanza is no longer needed. Daemon
  bootstrap now writes `<profileDir>/runtime/daemon/dropin-kinds.json` (best-effort,
  never blocks startup — `dropin.ts`'s `writeDropInKindsCache`, computed via the
  existing `collectProviderKinds` over the loaded drop-ins) right after `6.1b`'s
  registry wiring. `resolveKindsForProfile` grew an optional second `profileDir`
  param (backward compatible — omitted everywhere except the 3 real call sites,
  which all already had a `LoadedProfile`: `kindsForLoaded`/`agent-launch.ts`,
  `completion.ts`, `agents-state.ts`) that reads the cache and merges it into
  `fromProviders`, so a profile's own `agents.kinds` overlay still wins on a
  same-id conflict. 10 new unit tests (round-trip, corrupt-file, empty-map removes
  stale cache, merge-precedence). **Live-verified end to end**: a real
  `.sm/providers/kimi.mjs` with only `kindBase()` (no `agents.kinds.kimi:` yaml
  anywhere in the profile) showed up correctly in both `sm kind list` and
  `sm kind show kimi` after one real daemon bootstrap — the exact "just the one
  `.mjs` file" experience the design doc called the ideal but deferred. / 6.1d
  landed 2026-09-20: `providers list|scan` (`main.ts`'s `cmd === "providers"` block)
  now calls `loadDropInProviders` and registers the result into that call site's
  local registry, same as the daemon — `main()` was already `async`, so this needed
  one `await` at one call site, not the wider ~30-site refactor the design ruled out
  for Phase 1. Scoped to just `providers list|scan`, not the other ~20
  `createRegistryForProfile` call sites (`switch` verification etc.) — those stay
  untouched, matching the design's "adopt incrementally" framing. Live-verified: a
  real `.sm/providers/smoke.mjs` fixture showed up in `providers list` output
  alongside the builtins; a mesh with no `.sm/providers/` dir (the common case)
  stayed silent and unaffected. **All of 6.1 (a/b/c/d) is now landed.**
- [x] **6.2** `sm kind list|show [id]` — dump resolved kinds (provider ⊎ overlay ⊎ runners) for custom-profile DX
- [x] **6.3** Completion / help from `resolvedKinds` (not static `CLI_TYPES` list) — `switch`/`handoff`/`set <target> <cli>` and `secretary switch <cli>` tab-complete a profile's `agents.kinds` overlay ids (falls back to the builtin list outside any `.sm/`)
- [x] **6.4** Prune dual-path: `isOpenCodeCpeResumeCmd`'s regex fallback removed from
  every site where the generic prove-pattern check (`resumeCmdMatchesKindProve`/
  `entryWantsProxyRecovery`) already covers it — `resolveLaunchCmd` (agents-state.ts),
  `resolveHarnessType` (pane-resume.ts), `isOpenCodeCpeKind`/`detectPaneType`/
  `buildSavedResumeCmd`/secretary-preserved-type (save-session.ts). Kept as an
  explicit fallback (`kinds ? generic : legacy`) rather than deleted outright —
  every live call site always passes `kinds` today, but this keeps the function
  correct if that ever changes. **Found + fixed a real pre-existing bug** while
  adding test coverage: `detectPaneType`'s kinds-based branch returned
  `preserved.type` whenever it resolved to *any* valid kind (e.g. plain
  `"opencode"`), even when the actual CPE-recovery match came from a *different*
  kind's prove pattern — silently losing the CPE type on a pane whose `type` field
  went stale. **Deliberately left untouched**: `buildCustomKindLaunchCmd`'s
  opencode-cpe branch (provably unreachable in every live path — `buildKindLaunchCmd`'s
  kinds-based early return always intercepts first; only reachable via the
  already-`@deprecated`, zero-live-callers `buildLaunchCmd`), `opencode-launch-sanitize.ts`
  (dead code, no live callers anywhere), `opencode-cpe-atomics.ts`'s inline duplicate
  regex (freshly proven/battle-tested atomic recovery code, redundant check costs
  nothing at runtime since it's an OR, not worth the risk to touch for zero benefit).
  24 new tests using real resolved kinds (`resolveKindsForProfile`, not hand-typed
  fixtures) across `save-session.test.ts`/`pane-resume.test.ts`/new
  `agents-state.test.ts`. Verified live end-to-end too: `sm save` against a real
  tmux session with a real opencode pane ran the full `scrapeMeshAgents` pipeline
  through every changed function with no crash and correctly classified the plain
  opencode pane as `opencode`, not a false-positive `opencode-cpe`.
- [x] **6.5a** Canonical CPE kind **`opencode-cpe`**; `oc-proxy` only as normalize/aliases + thin `scripts/oc-proxy-*.sh` shims
- [x] **6.5c** **Migration close:** `oc-proxy` in mesh.config (`providers` / `runners` / `layout.cli`) still launches CPE; 4 atomics (record→kill→revive→CONTINUE) proved
- [ ] **6.5b** Delete `origin/oc-proxy` + retire `tools/shadow-oc-proxy.sh` / sync workflow when meshes migrated off alias keys. Not attempted autonomously: deleting a remote git branch is destructive and explicitly needs an operator's go-ahead, not an autonomous call.
- [x] **6.6** E2E: custom `agents.kinds.my-oc: { extends: opencode, … }` through `switch` + save prove (`packages/providers/src/builtin.test.ts`)
- [x] **6.7** Example mesh doc: add Kimi (launch-only yaml vs full provider) — no fork (`docs/EXAMPLE-CUSTOM-KIND-KIMI.md`)

---

## P7 — single host daemon (see NOW.md "Direction")

Today: N meshes on one host = N independent `mesh-inbox-supervisor` + `mesh-inbox-server`
process pairs (N health-watch loops, N HMR-poll loops). Goal: one host-level process,
without reinventing Herdr's agent-status surface.

- [x] **7.1** **Phase 1 — host supervisor (opt-in).** `seatmesh host up|down|status`:
  one `mesh-inbox-host-supervisor` walks `sessions.json`, runs a `mesh-inbox-watcher`
  per registered mesh. Still N `mesh-inbox-server` processes/ports. Not wired into
  `ensureMeshInbox` — existing meshes unaffected unless opted in. Landed 2026-09-19.
- [~] **7.2** Prove phase 1 under real multi-day load on this box (seatmesh/pia/zsign/
  dc-agent), including HMR-restart and health-rescue paths, before defaulting to it.
  **Clock actually started 2026-09-20T08:33Z** — ran `seatmesh host up` for real
  (previously it had never once been started; 7.2 was stuck at zero evidence).
  Confirmed on landing: `host status` shows all 4 registered meshes; seatmesh/pia
  (already had live per-mesh daemons) correctly show `pid=-` — adopted, not
  duplicated, per 7.3's proven coexistence logic; zsign/dc-agent (no daemon running
  at all before this) got real daemons spawned for the first time. `/health` on
  seatmesh/pia unaffected (same pids as before `host up`, zero disruption). Still
  `[~]` not `[x]` — multi-day is multi-day, this only starts the clock, doesn't
  finish it. Revisit `~/.config/seatmesh/host-supervisor.json` and each mesh's
  `mesh-inbox.log` for HMR-restart/health-rescue behavior under the host supervisor
  specifically after real elapsed time.
- [~] **7.3** Default `ensureMeshInbox`/`seatmesh start`/`engine` to the host supervisor
  when `host up` is already running; retire the per-mesh auto-spawn path. **The
  "prefer" half is already true today, verified 2026-09-19 — no new code needed**:
  `ensureMeshInbox` already returns early once a mesh's daemon answers healthy
  regardless of who spawned it, and `mesh-inbox-watcher`'s spawn pre-check already
  detects+skips when something's already serving (both proven in the phase-1 work).
  Live-tested the exact case: registered a mesh, ran `host up` *first* (so the host
  supervisor spawned its daemon), then ran the normal per-mesh `inbox status` path
  for that same mesh — the meta file's `supervisorPid` correctly showed the host
  supervisor's pid, zero stray per-mesh `mesh-inbox-supervisor.js` process, exactly
  one daemon. **Not done, and deliberately not attempted**: "retire the per-mesh
  auto-spawn path" — actually deleting that fallback code. 7.2 (prove phase 1 under
  real multi-day load) hasn't happened yet, and removing the fallback now would
  strip pia/zsign's safety net before that's proven — exactly the sequencing 7.2's
  own text already calls for ("before defaulting to it").
- [~] **7.4** Phase 2 — collapse N `mesh-inbox-server` child processes into N in-process
  listeners inside one process. **Design done 2026-09-20, not implemented** — see
  [docs/HANDOUT-HOST-DAEMON-PHASE2.md](docs/HANDOUT-HOST-DAEMON-PHASE2.md). Found two
  concrete blockers by reading the actual file, not guessing: (1) `mesh-inbox-
  server.ts`'s fault isolation today relies on 4 `process.exit()` call sites that
  are correct for one-process-per-mesh and actively dangerous collapsed (one mesh's
  fatal error would kill every mesh on the host); (2) at least one real cross-mesh
  module-global — `compose-gate.ts`'s `skipTypingGate` flag — would let two meshes
  with different `daemon.skipTypingGate` config silently clobber each other.
  "Shared HTTP server dispatch by port/session" turns out unnecessary — N independent
  `http.Server`s in one process is simpler and keeps today's per-mesh port model.
  Biggest open question: HMR has no in-process equivalent of "the OS respawns the
  child with freshly-built code" — not solved in this pass. **Recommendation: do
  not implement** until 7.2 (Phase 1 proof) actually concludes and a full
  module-global audit (not just the one found here) is done — see the design doc's
  own reasoning. Broken into 7.4a (module-global audit) / 7.4b (`MeshInstance`
  extraction) / 7.4c (host-process integration) / 7.4d (HMR redesign), none started.
- [~] **7.5** `seatmesh host` status surfaced in the operator hub (:3190) instead of
  per-mesh `/health` polling from the picker. **Backend only, landed 2026-09-19**:
  new shared `readHostSupervisorMeta()`/`hostSupervisorSessionsByProfilePath()` in
  `@seat-mesh/core` (was duplicated as a local `interface HostMeta` in both the
  writer and the CLI reader — now one source of truth for a third reader too).
  `listHubSessions()` (`packages/web`) gets an additive `viaHostSupervisor: boolean`
  field per session — does not replace or change the existing `/health` polling,
  which still populates `daemonUp`/`health` exactly as before. Wired one level up
  into `mesh_sessions_controller.ts`'s Inertia props too. **Not done**: no Vue
  template treatment (`sessions/index.vue`) — `packages/web` has its own test
  runner (AdonisJS/Japa, not vitest, not in this repo's CI gates) and needs an
  actual browser to verify UI changes render correctly, which wasn't available
  this session. Verified everything that *could* be verified without one: `tsc
  --noEmit` on `@seat-mesh/web` shows zero new errors (same pre-existing,
  unrelated error set as before — auth/tasks typing gaps that predate this),
  and a live `seatmesh host up/down/status` smoke test confirms the refactor
  didn't break the CLI surface the shared utility now backs.
- [x] **7.6** Daemon diagnosability — first slice: wedge-snapshot capture. Distinct
  from 7.1-7.5 (which consolidate *how many* daemon processes run) — this is *when
  one breaks, why*. Before this, the only lever was "restart the daemon" — the
  health-rescue path (`mesh-inbox-watcher.ts`, 3 consecutive missed `/health`
  probes → SIGKILL) threw away the exact evidence that would explain 900+
  historical wedge events (found investigating 7.7) the moment it killed the
  process.
  - Added `packages/daemon/src/wedge-diagnostics.ts`: `writeWedgeSnapshot()` writes
    a single overwritten `<mesh>/.sm/runtime/daemon/last-wedge.json` right before
    the SIGKILL — session, port, pid, health-miss counters, `/proc/<pid>/status`
    snapshot (state/VmRSS/threads, Linux-only, null elsewhere), and the last 40
    lines of the mesh's own daemon log. Deliberately one overwritten file, not one
    per event — 7.7 showed this can fire hundreds of times a day; an unbounded
    directory would just be a smaller version of the same opacity problem.
    Best-effort only — every failure mode is swallowed internally so diagnostics
    can never delay or block the actual rescue.
  - 8 unit tests (`wedge-diagnostics.test.ts`), all passing.
  - **Live-verified end to end**, isolated test mesh (`/tmp/seatmesh-wedge-smoke`,
    own `XDG_CONFIG_HOME`, no registry leak): spawned a real daemon child via
    `createMeshWatcher`, waited out the (hardcoded, correct-as-is) 45s health-check
    grace period, `SIGSTOP`'d the live child pid to simulate a genuine wedge,
    confirmed 2 consecutive health misses were detected, the rescue fired, and
    `last-wedge.json` was written with `procState.state: "T (stopped)"` — an exact
    match for the simulated fault — plus correct log tail, then confirmed the
    child was SIGKILL'd and cleanly respawned. Cleaned up all test artifacts and
    processes afterward; real `~/.config/seatmesh/sessions.json` unaffected
    (still exactly the 4 real sessions).
  - **What this is not**: this is a snapshot at the moment of a hard health-rescue,
    not per-subsystem fault classification (inject/queue/checkback/notify/
    connectivity). Knowing *which subsystem* broke inside a still-technically-
    "healthy" daemon is a bigger scope — the log tail in the snapshot is a step
    toward that (it captures whatever the daemon was last logging), but doesn't
    label a specific fault. Left as a possible follow-up, not attempted here.
- [x] **7.7** Investigate whether running via a symlinked dev install (vs a real npx/
  npm-published install) is actually implicated in reported daemon crashes. **Checked
  2026-09-19, evidence says no** — confirmed `sm`/`seatmesh` on this box are symlinked
  to this checkout (`~/.local/bin/sm -> .../seatmesh/bin/sm`, via `sm install`), but
  the actual daemon logs tell a different, much more concrete story:
  - Both pia and this repo's own `.sm` mesh show a severe, escalating pattern of
    health-rescue `SIGKILL` restarts (daemon wedged badly enough that `/health` missed
    3 consecutive probes) — **pia: 735 total** (Sep 15: 169, Sep 16: 263, Sep 17: 302),
    **this repo: 167 total** (Sep 17 alone: 96, the worst day for both).
  - **Zero SIGKILL rescues on either mesh since ~2026-09-18T01:18Z** — 27+ hours clean
    at time of writing, right after the last wedge event.
  - That cutoff lines up almost exactly with commits `28bb155` (prune launch/atomics/
    resume off `type===oc-proxy` hardcodes) through `c363df1` (oc-proxy config + 4
    atomics close the CPE migration), landed **2026-09-17 20:59–22:18 +08:00** (the
    evening before the wedging stopped on both meshes) — not a coincidence given how
    cleanly it lines up on two independently-running meshes.
  - Mechanism was almost certainly something in the pre-fix CPE/oc-proxy code blocking
    the event loop or getting stuck (matching the health-rescue's own framing:
    "CPU-starve / wedged loop"), not a module-resolution/symlink issue — symlinks
    don't explain a bug that started days before this session and stopped the moment
    the CPE migration closed. **Conclusion: this specific theory is not supported by
    the evidence; the real cause already got fixed** (6.5a/6.5c "migration close").
    Doesn't rule out symlinks mattering for something else, but there's no evidence
    for it in what actually happened.

---

## P8 — persona model + campaign contract (vision, operator direction 2026-09-19 — not scoped, do not implement without explicit go-ahead given blast radius on live meshes)

Full detail: [docs/HANDOUT-CAMPAIGN-CONTRACT.md](docs/HANDOUT-CAMPAIGN-CONTRACT.md).
Direction: move off fixed manager/secretary/worker/mini roles toward personas, and
replace today's supervise+balance contracts with a "campaign" concept that can
actually answer "what's the status of X?" — supervise/balance themselves are already
a strength (better than Herdr's equivalent per hands-on comparison); the gap is
status-queryability and role-death resilience, not the underlying mechanism.

- [~] **8.1** Personas replace fixed manager/secretary/worker/mini roles as structural
  concepts (ids are already open via P6; this goes further — roles stop being
  hardcoded engine assumptions). Default project = a bare terminal + `npx seatmesh`
  echo, not a pre-built base/workers/minis grid. Window 9 "logs" is still liked and
  should stay — operator says it's "no longer needed" in its *current* form once the
  multi-daemon-per-mesh setup is fully gone (P7) — confirm exactly what changes
  there before touching it; read literally the window existed partly to surface
  N-daemon log noise. **Scope audit done 2026-09-20, not implemented** — see
  [docs/HANDOUT-PERSONA-MODEL.md](docs/HANDOUT-PERSONA-MODEL.md). Measured, not
  guessed: 98 files reference `"manager"`/`"secretary"`/`"worker"`/`"mini"`
  literally (52 tmux, 22 core, 15 daemon, 9 cli); sampling shows most of these are
  genuine behavioral branches (cold-start prompts, switch/launch logic, hub
  display, fanout routing), not just default values — a multi-subsystem migration,
  not a bounded change like 8.4/8.6. Also found a second, mostly-vestigial closed
  role-enum system (`slot/types.ts`'s `SlotRole`/`SlotId`, one real caller) separate
  from the live `SeatKind` one. **Recommendation: do not implement** without a
  phased plan (broken into 8.1a-d in the design doc) — the "default project" half
  also needs one more clarifying pass on what the bare-terminal first-run actually
  says before it's buildable, and its window-9 piece is explicitly sequenced after
  P7 (7.2/7.4) concluding, which hasn't happened.
- [~] **8.2** Campaign contract — **TODO slices** (assignable work units, need
  **dependency edges** across balancers/teams — flat lists can't express "this FE
  slice depends on that API slice") + **Objectives** (the missing piece today: lets
  "30% complete, N left" be a real answer, not just per-slice done/not-done).
  **Supervisor** = nudger, **balancer** = assigner (today's "lead"); a manager
  persona can be both by default (Herdr's plain-mode simplicity). **Narrowest
  slice landed 2026-09-20 as 8.4** (ticket-style, atomic campaigns) — see 8.4.
  Dependency edges, Objectives-as-aggregate-status, and supervisor/balancer-as-
  persona-roles are explicitly **not** part of that landing — those still need the
  open questions in [docs/HANDOUT-CAMPAIGN-CONTRACT.md](docs/HANDOUT-CAMPAIGN-CONTRACT.md)
  resolved first (how % complete computes, how roles map onto personas).
- [ ] **8.3** Supervisor/balancer **role failover** — must be easy to "replug" a new
  agent into the role when the holder dies; a campaign whose progress depends on one
  un-replaceable agent staying alive is not resilient parallelism. Correctness
  requirement, not a nice-to-have.
- [x] **8.4** Default campaign shape = **ticket-style** (atomic, one unit) — the most
  stable of the three styles operators actually reach for (EPIC/BMAD-PRD/ticket) per
  feedback. EPIC (umbrella grouping) and PRD (extend-as-you-go spec) are later
  extensions, not the base shape. **Landed 2026-09-20**: `sm campaign
  create|list|show|assign|done|cancel|reopen|note` (`packages/core/src/runtime/
  campaigns.ts` + `packages/cli/src/commands/campaign-cli.ts`) — event-sourced
  jsonl log (same pattern as `nav-log.ts`), reduced to current state on read.
  Deliberately the narrowest possible slice: one atomic ticket (title, objective,
  status, assignee, freeform notes), **no dependency graph, no supervisor/balancer
  role changes, no persona-model changes** — purely additive new CLI surface + new
  event log, zero interaction with existing supervise/balance/room/task/role code,
  so a mesh that never runs `sm campaign` is byte-for-byte unaffected. 9 unit tests
  (fold/reduce logic + jsonl round-trip) + live-verified full lifecycle
  (create→list→note→reassign→done→show→status-filter) against a real throwaway
  mesh through the actual CLI, not just the core module.
- [~] **8.5** Campaign listing/status must scale to **~100 concurrent campaigns**
  (ticket-style usage means many small campaigns, not a handful) — a status model
  that only answers one campaign at a time (e.g. "ask the supervisor") won't hold up.
  **Measured against 8.4's implementation 2026-09-20, not just assumed**: synthetic
  load of 100 campaigns + ~140 more lifecycle events (notes/status/reassigns, ~240
  total jsonl lines) — `readCampaigns`'s full fold/reduce took 13ms in-process; the
  real CLI's `campaign list --status all` over the same data returned all 100 in
  0.275s wall time (dominated by normal Node/CLI startup, same as any `sm` command,
  not by the read). The flat read-and-filter approach holds up fine at the target
  scale — no pagination/index needed yet, contrary to what the item's framing
  assumed before measuring. Left `[~]` not `[x]`: this is one synthetic load test,
  not real multi-week usage, and doesn't touch the harder part of 8.5's original
  concern (a *status query* model beyond flat listing — e.g. "how many campaigns are
  blocked on X" once dependency edges from 8.2 exist).
- [~] **8.6** `sm` CLI authz simplification — role-gated restrictions ("you can't run
  this because You= is this") are a real pain point tied directly to 8.1.
  `requireCoordRole` was already persona-aware (via `isCoordKind`/`layout.base.kinds`)
  before this session touched it. **`requireRole` made persona-aware 2026-09-20**:
  resolves the pane's role through `seatKindFromId`/`layout.base.kinds` before
  checking the allowed-kinds list, so a custom persona column (e.g.
  `layout.base.kinds: { lead: manager }`) authorizes correctly without also being
  literally named `manager` — backward compatible, literal ids still resolve to
  themselves. Live-verified against a real parsed profile with a `lead: manager`
  kinds mapping. **`requireInboxLifecycleRole` deliberately left alone**: it has a
  narrower, tested, documented exclusion (manager-1 + secretary only, NOT
  manager-2/3 — bouncing inbox from a secondary manager wedges the shared daemon)
  that `seatKindFromId` can't express, since it collapses manager/manager-2/
  manager-3 to the same SeatKind. Caught this by running the existing test suite
  before committing, not by inspection — the first version of this change broke a
  real, tested safety exclusion. Not solved: how a persona column says "I'm *the*
  primary manager" vs "*a* manager-tier column" once ids are fully open — needs its
  own design pass, not decided here.
- [ ] **8.7** Chat rooms — flagged as "a good concept but hardly effectively executed"
  despite being the most-used `sm` CLI surface. **Partially addressed**: 5.10 landed
  dedupe/`cb=`/`tail`+`get` json+pane+truncate 2026-09-19 — confirm with operator
  whether that's what was meant, or more rework is wanted.

---

## P9 — ack protocol: move off manager-mediated ACK/ACK loops (vision, operator direction 2026-09-19 — not scoped)

- [~] **9.1** Agents report task completion as a cheap one-way "done" signal instead
  of routing through an ACK/ACK confirmation exchange with the manager. Driver: each
  agent-to-agent inject round is a real LLM prompt, not free chatter — this project's
  own `.sm/mds/` notes already flag an "n+1" problem from today's ack model. Herdr's
  simpler one-way status model is the reference point. **Investigated 2026-09-20,
  premise partially out of date** — read the actual current ack code
  (`packages/daemon/src/ack/*.ts`, `packages/core/src/ack/ack-algo.ts`) instead of
  assuming, same as 7.7's approach:
  - Opening an ack row (`openAckForPeerRow`) costs nothing extra — it's metadata
    attached to a peer delivery that was already happening, not a new inject.
  - Closing (`closeAcksOnFilings`) is already fully passive/one-way: it fires when
    the seat sends *any* later peer/inbox message, during the daemon's own sweep
    tick — no reply-to-the-manager round-trip is required, and nothing gets
    injected into the agent's pane to close it.
  - **The literal reminder re-inject mechanism — the actual "n+1" cost — is already
    disabled**, and has been for a while: `ack-algo.ts`'s `remindableAcks()`
    unconditionally `return []`s, with its own comment: *"Never re-inject. First ask
    paste is the only prompt; whoami/banner list open rows; `ack <id>` closes
    without a peer reply (n+1 was burning turns)."* `fireAckReminders`'s loop body
    is dead code as a result (empty input every tick).
  - Open acks surface today only via `whoami`/hub status (`whoami-context.ts`,
    `hub.ts`) — pull-based, read on an existing prompt, not a daemon-initiated push.
  - **What's actually still true about the vision**: there's no explicit lightweight
    "done" message type distinct from "the seat filed literally anything" — that's
    a real ergonomics gap (a worker can't cheaply signal "this specific ask is
    done" vs. just happening to send unrelated peer traffic later) — but it's not
    a prompt-cost problem anymore, since nothing injects to open or close a row.
  - Left `[~]` not `[x]`: the ergonomics gap above is real remaining scope, and 9.2
    explicitly says design this together with 8.2 (campaign Objectives), which
    doesn't exist yet — this investigation doesn't try to resolve that pairing,
    just corrects the cost-model premise it was reasoning from.
- [ ] **9.2** Tension with **8.2** (campaign Objectives): something still has to
  signal when an Objective moves, and that can't be the expensive ack loop this item
  is trying to remove — design these two together, not separately.

---

## P10 — modular architecture + sidebar UI (long-term vision, operator direction 2026-09-19 — not scoped, explicitly "in the future" not near-term)

- [ ] **10.1** Split the web hub / markdown hosting / notifications so they're usable
  standalone or composed with a different core engine (name-dropped: "workmux", a
  separate/adjacent tool, not part of this repo) — seatmesh-the-engine and
  seatmesh-the-tooling-pieces become separable.
- [ ] **10.2** Wormux-like session sidebar: open a seatmesh session, spawn the
  sidebar, see a list of sessions, each with a dropdown of which agents are in it.
  Distinct from the operator hub (:3190) — lighter, always-present picker.

---

## P11 — live bug fixes (operator hands-on, 2026-09-22)

- [x] **11.1** Pane banner shows no agent kind at all. **Landed**: `@mesh_kind`
  tmux option + a `kind` segment in the banner line (`name | kind | tasks | inbox |
  ack | status`), sourced from the already-detected `prov.id` in
  `paintOnePaneBorder` — no new per-tick resolution added. Dropped first (before
  tasks/inbox) when the pane's too narrow, since it's the newest/lowest-priority
  field. 3 new unit tests in `borders.test.ts` (present when there's room, cleanly
  omitted when absent, dropped-not-truncated when narrow).
- [x] **11.2** Banners reported as "stuck on idle, not updating" after trying a new
  feature. Root-caused, not reproduced live (no active daemon/tmux at
  investigation time — see reasoning below, not a guess): `orchestratorDrainTick(Async)`
  runs 9 steps in sequence ending with border-paint, with **no error isolation
  between them** — a persistent (not just transient) exception in any earlier step
  (inbox/peer/checkback/target/ack draining) would silently prevent painting from
  ever running again, every tick, with zero log signal. That's a real,
  independently-justified reliability gap regardless of what specifically threw —
  the same "daemon opacity" pattern as TODO 7.6. **Fixed**: each step now runs
  through `step-isolation.ts`'s `runStep`/`runStepAsync` — catches, logs once per
  step-label per 60s (not every tick), returns a safe fallback, and always
  continues to the next step, so paint always gets its turn even if something
  earlier is persistently broken. 11 new unit tests. Does not fix whatever the
  *original* throwing step was (unknown, not reproduced) — fixes the class of bug
  where one broken step can silently take banners down with it.
- [ ] **11.3** CLI startup is slow on every invocation ("slow as hell, existing
  sessions"). **Measured, not guessed**: `sm kind list` ≈0.78s, `sm --help` ≈1.2s,
  vs ≈0.14s bare `node -e 1` baseline. CPU profile of a real invocation shows the
  time is ~entirely Node's own ESM module-resolution/compile machinery
  (`compileSourceTextModule`, `internalModuleStat`, `realpathSync`,
  `getPackageScopeConfig`, …), not application logic — `main.ts` statically
  `import`s essentially every command module at the top of the file regardless of
  which single command actually runs, so every command pays for the whole CLI's
  transitive dependency graph. This session's own new commands (`campaign`,
  `capture`, `nav`, `schedule`) each added to that fixed cost for *every*
  invocation, not just their own. Real fix is converting `main.ts`'s command
  dispatch to lazy `await import()` per branch — mechanical but large (the file is
  2700+ lines with dozens of branches); not attempted wholesale in this pass, see
  11.3a below for what *did* land.
  **Revisited 2026-09-23 — measured why the rest doesn't help the common case,
  not just assumed more lazy imports = faster**: `sm --skill` (needs *zero*
  `@seat-mesh/tmux` functionality) takes the same ~0.35s as `sm kind list`
  (needs plenty) — proof the two giant top-level imports (`@seat-mesh/core`
  ~27 names, `@seat-mesh/tmux` ~120 names) are paid by *every* invocation
  regardless of which branch runs, since they're module-level, not
  branch-scoped. Tried the obvious fix — move both into a single lazy,
  memoized load inside `main()`, skipped only by the true zero-dependency
  fast paths (`--skill`, `--help`, blank invocation) — and hit a real blocker:
  `meshLoaded()` (a module-level helper, not inside `main()`) calls
  `loadProfile` **synchronously**, and it's called from ~60+ of `main()`'s
  command branches. Lazy-loading `@seat-mesh/core` means `import()`, which is
  inherently async, which means `meshLoaded` would need to become async, which
  cascades into `await`-ing it at every one of those 60+ call sites — a much
  bigger, invasive, correctness-risky refactor than "add a few more lazy
  imports," and one that specifically wouldn't even help the highest-value
  case (`sm agent whoami`, called "every turn" per `.sm/AGENTS.md`) since that
  path needs `@seat-mesh/core`/`tmux` regardless of how the import is timed.
  **Not attempted this pass** — real fix needs a deliberate design/migration
  plan for `meshLoaded`'s async-ification, not a rushed 60-call-site change.
- [x] **11.3a** Lazy-loaded 9 command builders (`campaign`, `nav`, `room`,
  `contract`, `chat`, `notify`, `preview`, `schedule`, `mds`; `host` was already
  lazy) — each was already dynamically dispatched through a
  `buildXCommands(getLoaded)` factory pattern, so converting their **module-level**
  import to a `dynamic import()` inside each `if (cmd === "...")` branch was safe
  and mechanical, not a redesign. **Measured real improvement**: `sm kind list` (a
  command that uses none of these 9 modules) dropped from ~0.78s to ~0.5-0.65s
  just from shrinking the baseline import graph every command pays for; `sm help
  spawn` (the one with an existing 1000ms CI budget test,
  `cli-speed.test.ts`) now runs consistently 0.5-0.74s locally, down from the
  ~1.2s this investigation started with. Full test suite + Docker CI both green
  (one known-flaky, unrelated timeout on `secretary-auto-restart.test.ts` under
  heavy same-session Docker load, confirmed by rerun). Smaller, bounded slice of
  11.3 — proves the pattern works and gets 9 rarely-used modules' transitive
  dependency weight off the hot path for every other command, without touching
  the large static-import block most commands still share.
- [x] **11.4** Default project should replace manager-1 with a bare terminal
  echoing `seatmesh` (concrete spec from the operator, resolving 8.1's earlier
  "what does the echo actually say" open question). **Landed 2026-09-22**: new
  builtin kind `terminal` (`builtinLaunchLine` in `packages/core/src/agents/
  kinds.ts`) — `extends: empty` (so it's detected/painted as plain_shell, not a new
  provider family) with `launch: { builtin: "terminal" }`, a one-line
  `echo "seatmesh - run: seatmesh ..."` then `exec "${SHELL:-bash}"` into a real
  interactive shell. Init template's `layout.base.cli.manager` changed from
  `agent` to `terminal`, with a comment pointing at `sm switch manager agent` for
  anyone who wants the old behavior back. No new scaffold file needed — `command`-
  style kinds resolve to a script path relative to workspace, which would have
  required shipping a new file through `runInit`; a `builtin` avoids that
  entirely. 1 new unit test + live-verified: fresh `runInit` → `sm kind list`
  shows `terminal provider=empty launch=builtin:terminal` → `launchCmdFromKind`
  produces the exact expected one-liner → ran the echo directly to confirm valid
  bash. Does not touch secretary or any other column's default.
- [x] **11.5** Docs for running harness features modular/standalone (mds hosting,
  notifications, etc. — ties to 10.1's split-the-hub vision but asked here as "just
  document how to run these independently" rather than a full architecture split).
  **Landed 2026-09-22**: [docs/HANDOUT-MODULAR-HARNESS-FEATURES.md](docs/HANDOUT-MODULAR-HARNESS-FEATURES.md).
  Verified by reading the actual controllers/CLI code, not assuming: `sm web up`
  (`packages/web`) already runs mds hosting + notification-card viewing standalone
  — no live tmux session or daemon needed to start it or to view hosted markdown/
  Info cards (`mds_controller.ts` reads `.sm/mds/` straight off disk with
  `probe: false`; `mds-cli.ts`/`notify-cli.ts` have no daemon HTTP calls at all).
  The one real nuance: a notification card's Yes/No/Run **action buttons** do need
  that mesh's daemon reachable *at click time* to actually deliver/run something.
  What's genuinely not standalone yet: `packages/web` is one bundled app — no way
  to run "just mds hosting" as its own smaller process today; that's what TODO
  10.1 (long-term, not scoped) would actually change. This doc is the "how to use
  what exists" answer, not a preview of that split.
- [x] **11.6** `start`/`session up` on a fresh (never-created) session took 1min+
  to reach `tmux attach` — `sessionUp()` called `launchSession()` (waits up to
  180s for every seat's agent CLI to become composer-ready) and `ensureMeshInbox()`
  synchronously, before ever attaching. **Landed**: split into fast tmux
  scaffolding (unchanged, stays sync) + `finishSessionUp()` (launch + inbox +
  save), the latter now spawned as a **detached child** (`session finish-up`,
  internal) so attach isn't blocked on it — same "attach first, finish in the
  background" pattern `sessionAttach`'s re-attach path already used
  (`spawnDetachedSessionSync` -> `session sync`), extended to first-time
  creation. `SEATMESH_ATTACH_SYNC=1` forces the old fully-synchronous behavior
  (same escape hatch already used for re-attach). Live-verified: fresh session
  now reaches the attach point in ~5s (measured via `SEATMESH_ATTACH_DRY=1`,
  down from 1min+); confirmed the detached child actually completes the deferred
  work correctly (daemon went healthy, secretary's agent CLI launched) by
  watching it run to completion, not just checking it was spawned.
- [x] **11.7** `npx seatmesh web` from outside any `.sm/` workspace refused with
  "no mesh workspace here", even though the hub is a host-level view over the
  global session registry (same spirit as `seatmesh host`), not tied to any one
  project. **Landed**: added `web`/`open-web` to `bin/seatmesh`'s
  `allow_outside_mesh` gate (the actual source of the error — a bash-level check
  before Node ever runs); made `loaded` optional throughout `web-cli.ts` so
  `web status`'s per-project shortcuts/daemon-health section is skipped cleanly
  (not guessed) when there's no project in cwd, while the registered-sessions
  list (which is what "easily check sessions" actually needs) already worked off
  the global registry regardless. Live-verified through the real `bin/seatmesh`
  entrypoint (not just `main.js` directly) from `/tmp`.
- [x] **11.8** `seatmesh --skill` — a discovery/capability manifest so another
  tool or agent (e.g. a different harness wanting to shell out to seatmesh, not
  a human reading docs) can learn what it does and how to drive it, without any
  bespoke integration code on seatmesh's side. **Landed**: `--skill`/`skill`
  (plain and `--json`), name/description/when-to-use/entry-points/integration-
  notes + the full command list generated from `listHelpEntries()` (same source
  `docs/COMMANDS.md` uses — not hand-duplicated, stays in sync automatically).
  Works from anywhere, no `.sm/` workspace needed (added to `bin/seatmesh`'s
  `allow_outside_mesh`, same as `web`/`host`). Integration shape is plain
  shell-out (`npx seatmesh <cmd> [--json]` / `sm <cmd>`) — no SDK, no API
  server; scoped deliberately narrower than a real embeddable plugin API, which
  would need to know the target tool's own plugin contract first (not
  attempted here). 8 unit tests + live-verified through the real `bin/seatmesh`
  entrypoint from outside any workspace, both plain and `--json` output.

---

## Prove bar (every closed row)

```bash
sm verify
sm providers scan
# operator: attach mesh in Ghostty — eyeball borders + CLIs
```

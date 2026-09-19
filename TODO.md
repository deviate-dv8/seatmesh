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
- [ ] **4.5** cutover doc: when workers leave `dev` — **surpass gate D** — stale, see note above.
- [ ] **4.6** **Surpass gate A** — inbox list/resolve + fix :3100 health wedge (beats harness :3099 for manager ops) — stale, see note above.

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
- [~] **5.12** base layer `pane-meta|panes|capture|inject|interrupt|restart` — surface tmux primitives as verbs (P4-2). `pane-meta`/`panes` already landed (see `pane-meta-cli.ts` "P4-2" comment). `capture`/`inject`/`interrupt`/`restart` as raw CLI primitives would contradict "No direct send" in ARCHITECTURE.md — the daemon is supposed to be the *only* pane writer. Do not implement those four without deciding how they coexist with that rule first (e.g. read-only `capture` is probably fine; `inject`/`interrupt`/`restart` as bypass primitives are not).

---

## P6 — agent kinds (open registry / no-fork CLIs)

Landed on `agent-kinds-json` → `1.2.4`: provider `kindBase`/`kindExtensions`, `agents.kinds` overlay,
prove/satisfy/recovery, open `type` strings. CPE = `opencode-cpe` **extends** `opencode`.

- [ ] **6.1** **`.sm/providers/` load** — drop-in provider modules (e.g. `kimi.mjs`) without engine PR/fork; register into builtin registry + emit `kindBase`. Today: launch-only via `agents.kinds`; full inject still needs a provider class in `@seat-mesh/providers` (or this loader). **Design done, not implemented** — see [docs/HANDOUT-PROVIDERS-DROPIN.md](docs/HANDOUT-PROVIDERS-DROPIN.md): `.mjs` file contract, error-isolation wrapper (a throwing/hanging drop-in provider must not take the shared daemon down), and why Phase 1 is daemon-registry-only (`resolveKindsForProfile`/`createRegistryForProfile` are sync and have ~30+ call sites — making them async to support this would be a much bigger refactor than the feature is worth). Broken into 6.1a (loader+validation+wrapper, landed 2026-09-19) / 6.1b (wire into
  daemon bootstrap only, landed 2026-09-19 — inject-capable drop-in providers now
  work for real, no PR/fork needed; still requires the `agents.kinds` yaml stanza
  from EXAMPLE-CUSTOM-KIND-KIMI.md too, per the design's Phase-1 scope) / 6.1c (kind
  auto-merge so the yaml stanza isn't needed either, deferred) / 6.1d (CLI-side
  registry adoption — `providers list/scan` etc. don't see drop-ins yet, deferred).
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
- [ ] **7.2** Prove phase 1 under real multi-day load on this box (seatmesh/pia/zsign/
  dc-agent), including HMR-restart and health-rescue paths, before defaulting to it.
- [ ] **7.3** Default `ensureMeshInbox`/`seatmesh start`/`engine` to the host supervisor
  when `host up` is already running; retire the per-mesh auto-spawn path.
- [ ] **7.4** Phase 2 — collapse N `mesh-inbox-server` child processes into N in-process
  listeners inside one process (per-mesh queue isolation preserved, one Node process
  total). Bigger: shared HTTP server dispatch by port/session, one event loop.
- [ ] **7.5** `seatmesh host` status surfaced in the operator hub (:3190) instead of
  per-mesh `/health` polling from the picker.
- [ ] **7.6** Daemon diagnosability. Distinct from 7.1-7.5 (which consolidate *how many*
  daemon processes run) — this is *when one breaks, why*. Today the only lever is
  "restart the daemon," never "here's what actually failed." Add structured crash/
  fault visibility (which subsystem — inject/queue/checkback/notify/connectivity —
  actually broke) so operators stop papering over real bugs with restarts.
- [ ] **7.7** Investigate whether running via a symlinked dev install (vs a real npx/
  npm-published install) is actually implicated in reported daemon crashes. Operator's
  own words: unconfirmed theory ("idk"), worth checking before assuming.

---

## P8 — persona model + campaign contract (vision, operator direction 2026-09-19 — not scoped, do not implement without explicit go-ahead given blast radius on live meshes)

Full detail: [docs/HANDOUT-CAMPAIGN-CONTRACT.md](docs/HANDOUT-CAMPAIGN-CONTRACT.md).
Direction: move off fixed manager/secretary/worker/mini roles toward personas, and
replace today's supervise+balance contracts with a "campaign" concept that can
actually answer "what's the status of X?" — supervise/balance themselves are already
a strength (better than Herdr's equivalent per hands-on comparison); the gap is
status-queryability and role-death resilience, not the underlying mechanism.

- [ ] **8.1** Personas replace fixed manager/secretary/worker/mini roles as structural
  concepts (ids are already open via P6; this goes further — roles stop being
  hardcoded engine assumptions). Default project = a bare terminal + `npx seatmesh`
  echo, not a pre-built base/workers/minis grid. Window 9 "logs" is still liked and
  should stay — operator says it's "no longer needed" in its *current* form once the
  multi-daemon-per-mesh setup is fully gone (P7) — confirm exactly what changes
  there before touching it; read literally the window existed partly to surface
  N-daemon log noise.
- [ ] **8.2** Campaign contract — **TODO slices** (assignable work units, need
  **dependency edges** across balancers/teams — flat lists can't express "this FE
  slice depends on that API slice") + **Objectives** (the missing piece today: lets
  "30% complete, N left" be a real answer, not just per-slice done/not-done).
  **Supervisor** = nudger, **balancer** = assigner (today's "lead"); a manager
  persona can be both by default (Herdr's plain-mode simplicity).
- [ ] **8.3** Supervisor/balancer **role failover** — must be easy to "replug" a new
  agent into the role when the holder dies; a campaign whose progress depends on one
  un-replaceable agent staying alive is not resilient parallelism. Correctness
  requirement, not a nice-to-have.
- [ ] **8.4** Default campaign shape = **ticket-style** (atomic, one unit) — the most
  stable of the three styles operators actually reach for (EPIC/BMAD-PRD/ticket) per
  feedback. EPIC (umbrella grouping) and PRD (extend-as-you-go spec) are later
  extensions, not the base shape.
- [ ] **8.5** Campaign listing/status must scale to **~100 concurrent campaigns**
  (ticket-style usage means many small campaigns, not a handful) — a status model
  that only answers one campaign at a time (e.g. "ask the supervisor") won't hold up.
- [ ] **8.6** `sm` CLI authz simplification — role-gated restrictions ("you can't run
  this because You= is this") are a real pain point tied directly to 8.1;
  `requireRole`/`requireCoordRole` (`packages/tmux/src/agents/authz-guard.ts`) will
  need to loosen or become persona-aware.
- [ ] **8.7** Chat rooms — flagged as "a good concept but hardly effectively executed"
  despite being the most-used `sm` CLI surface. **Partially addressed**: 5.10 landed
  dedupe/`cb=`/`tail`+`get` json+pane+truncate 2026-09-19 — confirm with operator
  whether that's what was meant, or more rework is wanted.

---

## P9 — ack protocol: move off manager-mediated ACK/ACK loops (vision, operator direction 2026-09-19 — not scoped)

- [ ] **9.1** Agents report task completion as a cheap one-way "done" signal instead
  of routing through an ACK/ACK confirmation exchange with the manager. Driver: each
  agent-to-agent inject round is a real LLM prompt, not free chatter — this project's
  own `.sm/mds/` notes already flag an "n+1" problem from today's ack model. Herdr's
  simpler one-way status model is the reference point.
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

## Prove bar (every closed row)

```bash
sm verify
sm providers scan
# operator: attach mesh in Ghostty — eyeball borders + CLIs
```

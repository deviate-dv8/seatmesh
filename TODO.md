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
- [ ] **2.5** `schedule`
- [ ] **2.6** `dc-feedback`

**Hard rule:** only daemon calls `inject.ts`.

---

## P3 — manager / secretary / minis

- [x] **3.1** `secretary start|stop|…` — `start`, `restart`, `switch`, `dispatch`, `collect`, `status`, `watch`, `supervise` already existed; added `stop` (switch secretary → empty, same path as `switch <target> empty`)
- [~] **3.2** `mini list|spawn|prompt|done|dispatch-all` + `secretary dispatch` (`minis.ts`)
- [x] **3.3** minis grid + leads from profile (`layout.minis.grid` / `max` / `leads`, `sm layout`)
- [-] **3.4** `triage` / `board-sync` — optional thin wrapper
- [x] **3.5** `contexts` / `seats` — `contexts.ts` (FOCUS preview + open TASK/REMINDER counts, `--json`)
- [ ] **3.6** `nav log|summary`
- [-] **3.7** `manager-reminder`
- [~] **3.8** `proxy` — status/check only

---

## P4 — cutover (see `docs/SURPASS.md`)

- [~] **4.1** `mesh-agents.json` (mesh-owned state) — save/read + set/tag + switch auto-save; full json engine still open
- [ ] **4.2** `session down` (never touch `dev`)
- [ ] **4.3** kiro trust dialog on launch
- [ ] **4.4** Cursor composer-ready wait before handoff
- [ ] **4.5** cutover doc: when workers leave `dev` — **surpass gate D**
- [ ] **4.6** **Surpass gate A** — inbox list/resolve + fix :3100 health wedge (beats harness :3099 for manager ops)

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
- [ ] **5.9** `worktree` — `sm worktree new|rm|backlog <slug>` wrapping the three scripts (P2-4)
- [x] **5.10** `room say` dedupe window + `cb=<id>` output; `room tail` id/pane/truncate + `--json`; `room get <id>` (P3-1/P3-2)
- [x] **5.11** `chat put|get` — positional upsert + id/turnHash lookup (P3-3)
- [ ] **5.12** base layer `pane-meta|panes|capture|inject|interrupt|restart` — surface tmux primitives as verbs (P4-2)

---

## P6 — agent kinds (open registry / no-fork CLIs)

Landed on `agent-kinds-json` → `1.2.4`: provider `kindBase`/`kindExtensions`, `agents.kinds` overlay,
prove/satisfy/recovery, open `type` strings. CPE = `opencode-cpe` **extends** `opencode`.

- [ ] **6.1** **`.sm/providers/` load** — drop-in provider modules (e.g. `kimi.js`) without engine PR/fork; register into builtin registry + emit `kindBase`. Today: launch-only via `agents.kinds`; full inject still needs a provider class in `@seat-mesh/providers` (or this loader).
- [x] **6.2** `sm kind list|show [id]` — dump resolved kinds (provider ⊎ overlay ⊎ runners) for custom-profile DX
- [x] **6.3** Completion / help from `resolvedKinds` (not static `CLI_TYPES` list) — `switch`/`handoff`/`set <target> <cli>` and `secretary switch <cli>` tab-complete a profile's `agents.kinds` overlay ids (falls back to the builtin list outside any `.sm/`)
- [ ] **6.4** Prune dual-path: retire `isOpenCodeCpeResumeCmd` / `buildCustomKindLaunchCmd` opencode-cpe special-case once prove-only path is sole
- [x] **6.5a** Canonical CPE kind **`opencode-cpe`**; `oc-proxy` only as normalize/aliases + thin `scripts/oc-proxy-*.sh` shims
- [x] **6.5c** **Migration close:** `oc-proxy` in mesh.config (`providers` / `runners` / `layout.cli`) still launches CPE; 4 atomics (record→kill→revive→CONTINUE) proved
- [ ] **6.5b** Delete `origin/oc-proxy` + retire `tools/shadow-oc-proxy.sh` / sync workflow when meshes migrated off alias keys
- [ ] **6.6** E2E: custom `agents.kinds.my-oc: { extends: opencode, … }` through `switch` + save prove
- [ ] **6.7** Example mesh doc: add Kimi (launch-only yaml vs full provider) — no fork

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

---

## Prove bar (every closed row)

```bash
sm verify
sm providers scan
# operator: attach mesh in Ghostty — eyeball borders + CLIs
```

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

**Rules:** `./sm.sh` ≠ harness plugin. Code in `seatmesh/packages/*` only. Do **not** write `tmux-main-agents.json` from sm (read-only seed until `mesh-agents.json` exists).

**Status:** `[x]` done · `[~]` partial · `[ ]` not started · `[-]` defer

---

## P0 — broken / unusable

- [x] **0.1** `list-panes -s` bug — labeled whole session as minis → `window-panes.ts`
- [x] **0.2** 3×2 workers + 4×2 minis layout → equal `select-layout` grid (`layoutWorkers3x2` / `layoutMinis4x2`; `./sm.sh layout` fixes live session)
- [x] **0.3** `@mesh_*` labels + border strip → `labels.ts`, `borders.ts`
- [x] **0.4** Launch CLIs on session up → `launch.ts` + `agent-builder.ts` (reads harness JSON read-only)
- [x] **0.4b** Pane env before CLI → `session-env.ts` (NO_COLOR scrub) + `opencode-cpe.sh` for OC proxy
- [x] **0.5** `./sm.sh verify`
- [x] **0.6** `./sm.sh labels`

---

## P1 — daily harness feel

- [~] **1.1** `whoami` — works; harness POV doc map not wired
- [x] **1.2** `manager`
- [x] **1.3** `prompt` / `prompt --manager` — enqueue PEER.jsonl; daemon inject (handoff/mini spawn still direct)
- [x] **1.4** `flush` — `flush.ts` (Enter rescue / Esc stuck draft)
- [x] **1.5** `switch` / `handoff` — relaunch + FOCUS handoff (`switch.ts`)
- [x] **1.6** `set` / `tag` — persist type/resumeId to `mesh-agents.json` (`set-tag.ts`; JSON only, no relaunch)
- [~] **1.7** `save` / `auto` — scrape live mesh -> `mesh-agents.json` (layout.minis + slot CLI state)
- [x] **1.8** `title` / `status` — `@mesh_title` / `@mesh_status` + border
- [x] **1.9** `remind` — manager-only; enqueue PEER.jsonl (`remind.ts`)
- [ ] **1.10** `continue` + `night`
- [ ] **1.11** `slot-advice`
- [x] **1.12** `providers list|scan`
- [x] **1.13** `peek <target> status|full` — `roles/peek.ts`; operator 23:29; mini review pending

---

## P2 — inbox / comms

- [~] **2.1** mesh inbox daemon (`mesh-inbox-server.ts` **:3100** — `JsonlStore` + `mesh-orchestrator` + `border-paint`; BullMQ when Redis reachable, poll fallback). **Radar:** health wedge ~1–2s post-restart; delivery proof landed (`isInboxDelivered`); list/resolve routes still open (see **5.2**)
- [x] **2.2** `to-master` — enqueue + daemon inject (`deliverToPane`, `INBOX.jsonl` drain)
- [~] **2.3** peer comms — `./sm.sh to-slot` / `to-mini` enqueue `PEER.jsonl`; room/chat ledger separate
- [~] **2.4** `checkback` — `start|list|cancel` (`patience` alias) wrapping daemon `/patience`; no `schedule` yet
- [ ] **2.5** `schedule`
- [ ] **2.6** `dc-feedback`

**Hard rule:** only daemon calls `inject.ts`.

---

## P3 — manager / secretary / minis

- [ ] **3.1** `secretary start|stop|…`
- [~] **3.2** `mini list|spawn|prompt|done|dispatch-all` + `secretary dispatch` (`minis.ts`)
- [x] **3.3** minis grid + leads from profile (`layout.minis.grid` / `max` / `leads`, `./sm.sh layout`)
- [-] **3.4** `triage` / `board-sync` — optional thin wrapper
- [x] **3.5** `contexts` / `seats` — `contexts.ts` (FOCUS preview + open TASK/REMINDER counts, `--json`)
- [ ] **3.6** `nav log|summary`
- [-] **3.7** `manager-reminder`
- [~] **3.8** `proxy` — status/check only

---

## P4 — cutover (see `docs/SURPASS.md`)

- [~] **4.1** `mesh-agents.json` (mesh-owned state) — save/read layout + set/tag persist; switch relaunch still does not auto-save
- [ ] **4.2** `session down` (never touch `dev`)
- [ ] **4.3** kiro trust dialog on launch
- [ ] **4.4** Cursor composer-ready wait before handoff
- [ ] **4.5** cutover doc: when workers leave `dev` — **surpass gate D**
- [ ] **4.6** **Surpass gate A** — inbox list/resolve + fix :3100 health wedge (beats harness :3099 for manager ops)

---

## P5 — brainstorm backlog (aggregated in `tasks/seatmesh/docs/SM-FUNCTIONS.md`, mini-8 synth)

Open rows from the sm-functions campaign. Each ships as one function per SPEC (SMFUNCTIONS-SPEC.md) and gets a ONE-PATH.md row.

- [ ] **5.1** `checkback start` — positional expect + optional positional duration + `--here` alias + `ensureMeshInbox()` loud-fail (fix documented shape; P0-1)
- [~] **5.2** `inbox list|resolve` + `status --wait|--meta` + `log`/`instances` + daemon routes `GET /inbox` + `POST /inbox/resolve` (P0-2) — **workaround only:** bulk JSONL resolve used 23:28; CLI routes not shipped
- [~] **5.3** `tag` — `set`/`tag` shipped (resume id); `--auto` + `self` alias still open
- [ ] **5.4** `seat update|set|stamp|snap` — FOCUS/TASKS/REMINDER writes + ACTIVE-FOCUS stamp + snapshot wrap; filesystem parts shippable now, `seat set` blocks on 4.1 (P1-2)
- [ ] **5.5** `whoami --json` (P1-3)
- [ ] **5.6** workers layout profile-config — `layoutWorkersFromProfile` replaces hard-coded `layoutWorkers3x2` (DAN req; P1-4)
- [ ] **5.7** `notify` — `sm notify "<session>" ["<check>"]`, seat from TMUX_PANE, loud FAIL on missing notify-send (P2-1)
- [ ] **5.8** `preview` — `sm preview <file...> [--set <days>] [--notify]` wrapping publish-mdview.sh (P2-3)
- [ ] **5.9** `worktree` — `sm worktree new|rm|backlog <slug>` wrapping the three scripts (P2-4)
- [ ] **5.10** `room say` dedupe window + `cb=<id>` output; `room tail` id/pane/truncate + `--json`; `room get <id>` (P3-1/P3-2)
- [ ] **5.11** `chat put|get` — positional upsert + id/turnHash lookup (P3-3)
- [ ] **5.12** base layer `pane-meta|panes|capture|inject|interrupt|restart` — surface tmux primitives as verbs (P4-2)

---

## Prove bar (every closed row)

```bash
./sm.sh verify
./sm.sh providers scan
# operator: attach mesh in Ghostty — eyeball borders + CLIs
```

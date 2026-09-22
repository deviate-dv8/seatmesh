# Persona model — scope audit (TODO 8.1, not implemented)

Scoped 2026-09-20, same "design/audit before code" precedent as 6.1 and 7.4
(HANDOUT-PROVIDERS-DROPIN.md, HANDOUT-HOST-DAEMON-PHASE2.md). 8.1 is stated in two
parts in TODO.md; this covers both, with actual grep-measured scope for the first
one instead of guessing at its size.

## Part A: "roles stop being hardcoded engine assumptions"

Column **ids** are already open (P6, landed before this session): a profile can name
a coordinator column `lead` instead of `manager`, and `layout.base.kinds: { lead:
manager }` maps it to the `SeatKind` the engine understands. TODO 8.6 (this session)
extended that mapping to `requireRole`'s authz check specifically. What's *not* open
is the underlying `SeatKind` **type** itself — `packages/core/src/schema/seat-kind.ts`
says so directly: `SEAT_KINDS = ["manager", "secretary", "worker", "mini", "plain"]`,
comment: *"Seat kinds are closed."* 8.1 asks to open that up — a persona isn't
required to *be* one of those five things.

**Measured, not assumed, how big that actually is:**

- `grep -rl '"manager"\|"secretary"\|"worker"\|"mini"'` across `packages/*/src`
  (excluding tests) hits **98 files**: 52 in `tmux`, 22 in `core`, 15 in `daemon`,
  9 in `cli`.
- There are **two independent closed-role type systems**, not one:
  `schema/seat-kind.ts`'s `SeatKind` (backs layout, `requireRole`/`requireCoordRole`
  authz, CLI dispatch) and `slot/types.ts` + `slot/guards.ts`'s separate
  `SlotRole`/`CommsAction`/`SlotGuard`/`guardAllows()`. **Correction, 2026-09-23**:
  this session's first pass at that finding was wrong — checked one import path
  (`slot/types.ts` alone) and concluded "vestigial, one caller, type-only." Checked
  properly this time: `slot/guards.ts`'s `guardAllows(role, action)` is a real
  function, actively called from `tmux/agents/agent-dispatch.ts` (`roleAllowsVerb`,
  gating `sm agent`'s own can/cannot capability card — the single most-invoked
  command in the whole CLI per `.sm/AGENTS.md`'s "every turn: sm agent whoami").
  Not vestigial at all — it's a **second, independently-defined, currently
  load-bearing authz enforcement path**, running in parallel with `seat-kind.ts`'s.
  This raises 8.1's real risk, not lowers it: unifying these two enums means
  touching the exact authz logic gating every agent's every command, not a safe,
  isolated cleanup — do not treat this as a "warm-up" step. 8.1b's planned
  per-hit categorization (below) needs to explicitly separate "SeatKind-based" vs
  "SlotRole-based" coupling as two related but distinct systems to reconcile, not
  one.
- Sampling `tmux` (the largest bucket, 84 of its 98 hits are literal `role ===
  "manager"`-style branches, not just defaults) shows this is **real behavioral
  coupling, not just fallback values**: `cold-start-inject.ts` injects a
  structurally different cold-start prompt per literal role, `switch.ts` branches
  actual launch/kind-resolution behavior on `row.role === "manager"` vs
  `"secretary"` vs `"worker"`, `hub.ts`/`pane-kind.ts`/`seat-todo.ts` route display
  and target-resolution the same way. This is spread across cold-start, switch/
  launch, hub display, pane classification, chatroom fanout (`core/chatroom/
  fanout-routing.ts`, `agent-id.ts`), contracts (`core/contracts/agent-apply.ts`'s
  `mainLead: "manager"` default), and todos routing (`reportTo: "manager"`
  default) — not one subsystem, most of the engine's coordination surface.

**What this means for scoping:** this is not a bounded, few-file change like 8.4 or
8.6 — 98 files with genuine behavioral branches (not just string constants) is a
multi-subsystem migration. Attempting it in one pass risks silently changing
cold-start/switch/hub/fanout behavior for every live mesh on this host
(seatmesh/pia/zsign/dc-agent), which is exactly the blast radius the operator's own
2026-09-19 note in `HANDOUT-CAMPAIGN-CONTRACT.md` flagged for this whole P8 section.

## Part B: default project = bare terminal, not a pre-built grid

Separate from Part A's type-system question: change what `seatmesh init` scaffolds
by default (today: base/workers/minis 6+-pane grid) to a bare terminal + `npx
seatmesh` echo. This part is narrower — it's a template/scaffolding change, not an
engine-type change — but it's still a **default-behavior decision for every future
new project**, not an additive feature like 8.4. Two things worth surfacing before
anyone (including a future me) just wings this:

- "bare terminal + `npx seatmesh` echo" reads like a placeholder description from
  the original chat, not a full UX spec (what does the echo say? what's the actual
  first command a new operator runs from there?). Treating it as literal and
  shipping it as-is risks a worse first-run experience than today's grid, not a
  simpler one — worth one more round of "what should this actually say" before
  building it, not guessing.
- The operator's own note on window 9 ("logs") is conditional: keep it, but it's
  "no longer needed in its *current* form once the multi-daemon-per-mesh setup is
  fully gone (P7)" — P7 (7.2/7.4) hasn't concluded, so touching window 9's shape
  now would be sequenced ahead of its own stated dependency.

## Recommendation

Do not implement either part yet. Part A needs a real phased migration plan (see
below) given the measured 98-file, multi-subsystem scope — not a rewrite attempted
in one sitting. Part B needs one clarifying pass on what the bare-terminal
experience actually says/does before it's buildable, and its window-9 piece is
explicitly sequenced after P7 concluding.

## Proposed TODO.md breakdown (not started)

- **8.1a** — reconcile `slot/types.ts`/`slot/guards.ts`'s `SlotRole`/`CommsAction`/
  `guardAllows()` with `seat-kind.ts`'s `SeatKind` (same 5 values, two separate
  definitions). **Not** a low-risk warm-up — corrected 2026-09-23: `guardAllows`
  is live-load-bearing for `sm agent`'s capability card via
  `tmux/agents/agent-dispatch.ts`'s `roleAllowsVerb`. Needs its own careful pass
  (agent-dispatch.ts + agent-card.ts both consume these types functionally, not
  just as parameter annotations) before 8.1c can safely build on a single
  unified enum.
- **8.1b** — categorize all 98 hits precisely (not sampled): default/fallback value
  (safe to leave), display/routing branch (needs an open-persona equivalent),
  authz-relevant (needs the same `seatKindFromId` treatment 8.6 gave `requireRole`,
  now including the separate `SlotRole`/`guardAllows` path 8.1a covers).
  Turns "98 files" into an actual per-category plan instead of one scary number.
- **8.1c** — open `SeatKind` itself (or introduce a parallel open persona-id concept
  that `SeatKind` becomes a special case of) — the real engine-type change, blocked
  on 8.1b's categorization existing first.
- **8.1d** (Part B) — bare-terminal default scaffold, once the actual first-run
  copy/flow is nailed down; window-9 change sequenced after P7.

Do not implement 8.1a+ without confirming this plan with the operator first — same
bar as 6.1/7.4, and the reason is the same: measured blast radius across every live
mesh on this host, not hypothetical caution.

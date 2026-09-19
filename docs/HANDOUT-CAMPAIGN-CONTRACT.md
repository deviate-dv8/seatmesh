# Campaign contract (design brief — vision stage, not implemented)

**From:** operator (2026-09-19, via chat) · **For:** whoever picks up P7/persona-model work next.
**Status:** direction, not landed. No code exists yet. Captured here so it survives
past one chat session — see `TODO.md` P7 and `NOW.md` "Direction" for what *is* landed
(single-daemon migration phase 1).

## Why

Today's contracts — `.sm/contracts/_vendor/supervise.yaml` (nudges idle leads with
open TASKS) and `.sm/contracts/balance.extend.yaml` (spreads work across
leads/slots) — are genuinely good. Better than the equivalent in Herdr (a
comparable tool the operator has hands-on experience with). But two gaps:

1. They only work "when the assigned agent is keep on going" — if the agent holding
   the supervisor or balancer role dies, parallelism halts entirely. There is no
   succession today.
2. They can drive work but can't answer "what's the status of this campaign?" in
   any aggregate, queryable way (e.g. "30% complete, N things left").

Separately, this is tagged onto the broader move away from fixed
manager/secretary/worker/mini base roles toward personas (see `NOW.md` /
`docs/ARCHITECTURE.md` "Coordinator columns" — ids are already open, kinds are not
yet). A "campaign" is meant to be the persona-era replacement for
supervise+balance, not an additional third contract type.

## Shape

A campaign has:

- **TODO slices** — discrete, assignable units of work (term deliberately borrowed
  from Herdr's vocabulary). Assignable to any agent. Roughly today's seat
  task/TASK system, generalized off of fixed seats.
- **Slice dependencies** — slices are not a flat list. Worked example: a single
  operator prompt ("create a cron-job.org like project") gets triaged into a
  campaign that assigns a manager persona to itself and spins up two
  balancers/leads — an FE team and an API team. FE can mock up the design fast,
  but some FE slices have a prerequisite living in the API team's slices. A flat
  todo list (Herdr-style, and today's seatmesh) cannot express "this FE slice
  depends on that API slice." **Slices need dependency edges — effectively a DAG,
  possibly crossing balancer/team boundaries** — and campaign construction (the
  manager persona, during triage) should build that graph to minimize blocking
  (front-load/sequence so dependency chains stall as little downstream work as
  possible), not just list tasks in decomposition order.
- **Objectives** — the piece current contracts lack entirely. A higher-level goal
  definition that lets status be computed/queried in aggregate, not just
  per-slice done/not-done. Open question (not yet answered): are Objectives
  themselves checkable/gradable, or just descriptive text a supervisor reasons
  over when asked?
- **Supervisor** — "just a nudger" that keeps agents moving on their assigned
  slices. Same job as today's supervise-tick CONTINUE nudge, but must be a *role*,
  not a hard binding to one agent's lifetime (see Failover below).
- **Balancer** — the assignment mechanism. What the codebase calls a "lead" today
  is this role. Same failover requirement as supervisor.
- **Default/simple mode** — a manager persona can BE both supervisor and balancer
  by default: spawn agents, send slices per the campaign. This is explicitly "the
  herdr plain works" mode — seatmesh should match Herdr's simplicity for the
  simple case while keeping the richer supervise/balance model available for
  non-simple cases.

## Failover requirement (correctness, not a nice-to-have)

It must be **easy to "replug" a new agent into the supervisor or balancer role** to
pick the campaign back up — the goal is low-friction reassignment, not just
theoretical possibility. A campaign whose progress depends on one un-replaceable
agent staying alive is not actually resilient parallelism. This is a hard
requirement on the design, not an edge case to defer.

## Usage styles observed (real user feedback, informal)

Three shapes people reach for:

- **EPIC style** — a big umbrella grouping of related work (Jira-epic-like).
- **BMAD/PRD style** — starts as a living spec and gets extended as necessary as
  work proceeds, rather than fully decomposed upfront.
- **Ticket style** — one discrete, atomic unit of work.

**Ticket style has been the most stable of the three so far.** Design consequence:
don't assume campaigns need to support open-ended spec-extension or broad umbrella
grouping equally well out of the gate — design around the atomic/ticket shape
first, with EPIC/PRD as later extensions.

## Scale

Ticket-style usage means **~100 campaigns in flight**, not a handful — each ticket
is its own small campaign rather than one big umbrella. Campaign listing and status
querying need to work at that count (filtering, aggregate views across many
campaigns), not just single-campaign detail — a status-query model that only works
one campaign at a time (e.g. "ask the supervisor") won't hold up here.

## Adjacent pain points flagged in the same conversation (not campaign-specific, but related)

- `sm` CLI's role-gated authz restrictions ("you can't run this command because
  You= is this") are a pain point tied directly to the move away from fixed roles.
  Hardcoded `requireRole`/`requireCoordRole` checks
  (`packages/tmux/src/agents/authz-guard.ts`) will need to loosen or become
  persona-aware.
- Chat rooms (`packages/core/src/chatroom/room.ts`, `sm room ...`) are "a good
  concept but hardly effectively executed" despite being the most-used `sm` CLI
  surface. No specifics on the rework yet.
- Separately (contrast, not part of this doc's scope): the operator also wants to
  move agent task-completion reporting away from manager-mediated ACK/ACK loops
  toward a cheap one-way "done" signal (prompt cost is the driver) — this is in
  tension with Objectives needing *some* signal when a slice/objective moves, so
  the two should be designed together when this becomes real work, not separately.

## Not yet decided / open questions

- How "% complete" actually gets computed from Objectives.
- How supervisor/balancer map onto personas once fixed roles go away.
- How the "easy replug" mechanic actually works (detect death → reassign how, to
  whom, with what continuity of state).
- How status queries scale to ~100 campaigns without spamming a supervisor agent
  per query (ties into the daemon-diagnosability gap noted in `NOW.md`).

Given how much of current live-mesh behavior (pia/zsign/dc-agent, and this repo's
own `.sm`) depends on the current fixed-role/contract shape, none of the above
should be scoped into real implementation without an explicit go-ahead and a
concrete migration plan.

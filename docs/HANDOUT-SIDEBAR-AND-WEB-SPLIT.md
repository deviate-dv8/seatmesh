# Sidebar UI + web hub split — design (TODO 10.1/10.2, not implemented)

Scoped 2026-09-23, same "design before code" precedent as 6.1/7.4/8.1
(HANDOUT-PROVIDERS-DROPIN.md, HANDOUT-HOST-DAEMON-PHASE2.md,
HANDOUT-PERSONA-MODEL.md). Covers both TODO items together since they turned out
to share the same real finding once actually investigated.

## The real finding: the hard part is already separated

Read `packages/web`'s actual controllers instead of assuming a "split" means
extracting business logic out of a monolith. It doesn't — that part's already
done:

- `mesh_sessions_controller.ts` gets its session list from
  `session_registry.ts`'s `listHubSessions()`, which is itself a thin wrapper
  over `@seat-mesh/core`'s `readGlobalRegistry()` /
  `hostSupervisorSessionsByProfilePath()` (both landed this session, TODO 7.5)
  plus its own `/health` probing.
- `mds_controller.ts` (checked in detail for TODO 11.5) reads `.sm/mds/`
  straight off disk via `@seat-mesh/core`'s `listHostedMds`/`loadProfile` — no
  AdonisJS-specific state at all.
- Per-mesh agent/seat detail is already exposed over plain CLI too: `sm
  contexts --json` (TODO 3.5) gives one mesh's seats; `sm sessions list --json`
  gives every registered mesh, host-wide.

**What's actually coupled to `packages/web` specifically is the render step**,
not the data. Every controller calls `inertia.render(...)` — full Inertia/Vue
SPA responses, not JSON. Confirmed by reading `mds_controller.ts`'s actual
return statements: `inertia.render('mds/index', …)`, not `response.json(…)`.
There is no content-negotiation today — a non-Inertia client hitting these
routes gets an Inertia payload shaped for that specific Vue page, not a stable
API contract.

This reframes both TODO items:

- **10.1** ("split the hub so pieces are usable standalone") doesn't need
  extracting mds/notifications *out* of `packages/web` — the data access is
  already extractable, it's already living in `@seat-mesh/core`. What's missing
  is a stable, documented **JSON API surface** on the existing routes (or new
  ones) so a *different* frontend (a different tool, "workmux", or a plain CLI)
  can consume the same data without speaking Inertia's page-props protocol.
- **10.2** ("wormux-like sidebar") doesn't need `packages/web` **at all**. A
  session list + per-session agent dropdown is exactly `sm sessions list --json`
  + `sm contexts --json` per selected session — the same "shell out, no SDK"
  integration shape `--skill` (TODO 11.8) already established for external
  tools. A sidebar is really just another *external tool* by that definition,
  not a `packages/web` feature.

## Proposed shape

### 10.2 (buildable now, smallest real scope)

A standalone process, separate from `packages/web`:

- Poll `sm sessions list --json` on an interval (or watch
  `~/.config/seatmesh/sessions.json` for changes — it's a plain file) for the
  session list.
- On expand/select, per-seat data for the dropdown. Checked both real
  candidates rather than assuming: `sm contexts --json` (live-verified against
  pia) gives real seat/task data but not which **agent kind** is running per
  seat; `sm providers scan` is the actual per-pane-kind match (provider +
  resumeId + composer state per pane) but — checked, not assumed — has **no
  `--json` today**, plain tab-separated output only. A real prerequisite for
  10.2b, small and separable: add `--json` to `providers scan` (mirrors 6.1d's
  drop-in-aware registry, same command, just needs structured output added).
- Render shape is an open question deliberately **not decided here** — a
  system-tray app, a terminal TUI (`blessed`/`ink`-style), or a tiny
  always-on-top web page are all valid and none were specified. Whatever it is,
  it's a new small program, not a `packages/web` route.
- **Explicitly not needed**: no new seatmesh CLI/engine work at all — both
  JSON endpoints this needs already exist and are already tested/live-verified
  from earlier this session (11.8's `--skill` manifest documents exactly this
  kind of integration).

### 10.1 (bigger, needs an explicit API-surface decision)

- Add `Accept: application/json` (or a `?format=json` query param, AdonisJS
  supports both patterns) handling to the routes 10.2-style tools would
  actually want: `/sessions`, `/sessions/:id`, `/mds`, `/notifications` at
  minimum. Each controller already has the data shaped for Inertia — returning
  it as plain JSON instead of `inertia.render(...)` for those requests is
  additive, not a rewrite.
- **Not proposed here**: physically splitting `packages/web` into multiple
  npm packages. Given the data layer is already thin and reusable via
  `@seat-mesh/core` directly, a real "run just mds hosting standalone" need is
  better served by a *new*, smaller server package that imports
  `@seat-mesh/core` directly (same shape as 10.2's sidebar) than by surgically
  extracting routes out of the existing AdonisJS app. Physically splitting the
  Adonis app itself is a bigger, harder, lower-value move than it looks from
  the outside.

## Recommendation

- **10.2**: buildable independently, doesn't block on 10.1, doesn't touch this
  repo's engine code at all (pure external-tool consumer of already-existing,
  already-tested JSON endpoints). The only real open question is the render
  target (tray app vs TUI vs page), which needs the operator's own preference,
  not a guess.
- **10.1**: the JSON-content-negotiation slice (bullet above) is bounded and
  low-risk — could land as a real TODO item once there's a concrete consumer
  asking for it (10.2, or "workmux", or something else). Physically splitting
  the web package is not recommended at all under the current evidence; the
  actual blocker "workmux"-style composition needs was never really "the code
  is tangled," it was "there's no JSON API," which is a much smaller fix.

## Proposed TODO.md breakdown (not started)

- **10.1a** — JSON content-negotiation on `/sessions`, `/sessions/:id`, `/mds`,
  `/notifications` (additive, each controller already has the data shaped).
- **10.2a** — pick the render target (tray/TUI/page) — operator decision, not
  an engineering one.
- **10.2b** — build it, once 10.2a is decided. No seatmesh-side engine changes
  needed; it's a pure consumer of `sm sessions list --json` + `sm contexts
  --json`.

Do not implement 10.1a without confirming the API contract shape (JSON schema
per route) with the operator first, and do not start 10.2b without 10.2a
decided — same bar as every other design doc this session.

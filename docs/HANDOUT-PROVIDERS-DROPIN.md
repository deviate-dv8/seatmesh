# `.sm/providers/` drop-in loader — design (TODO 6.1, not implemented)

Scoped 2026-09-19 at the operator's request ("design 6.1 properly... before writing
code"). This is a design, not a plan to implement without review.

## Where this sits today

Per `docs/ARCHITECTURE.md` "Agent CLI: three layers" and
[EXAMPLE-CUSTOM-KIND-KIMI.md](EXAMPLE-CUSTOM-KIND-KIMI.md), a custom CLI already has
a **launch-only** path today with zero code changes: an `agents.kinds` overlay with
`extends: empty` + a `launch` command. What's missing is **layer 3 (inject)** — the
daemon can start the pane, but has no `AgentProvider` to detect it, read its
composer state, or paste messages into it, so PEER/queue delivery treats the pane
as plain shell. That needs a real provider class today, and today that means a PR
to `@seat-mesh/providers` itself (`builtin.ts` + a file in `packages/providers/src/`)
— not something a consumer project can drop in on its own. 6.1 is closing that gap.

## The real constraint: sync/async mismatch

`createRegistryForProfile(profile)` (registry construction) and
`resolveKindsForProfile(profile)` (kind/launch-command resolution) are both
**synchronous**, and both are called from a lot of places:

- `createRegistryForProfile`: ~30 call sites across `main.ts`, `chat-cli.ts`,
  `contract-lock-cli.ts`, the daemon (`mesh-inbox-server.ts`), and connectivity
  (`oc-limit-v2.ts`, `opencode-cpe-atomics.ts`). All pass `loaded.profile` only.
- `resolveKindsForProfile` (via `kindsForLoaded`): the `switch`/`launch`/`set`/`tag`
  CLI paths — user-facing, currently synchronous.

Loading a project-local `.mjs` file is inherently **async** (`import()`). Two ways
to reconcile that, and this design picks the lower-risk one:

- **Rejected for Phase 1**: make both functions async. Correct long-term, but touches
  every one of those ~30+ call sites (add `await`, propagate `async` up through
  whatever calls them) — a big, wide-blast-radius refactor for a feature whose
  actual value (drop-in *inject* capability) only needs ONE of those call sites: the
  daemon's own registry construction.
- **Phase 1 (this design)**: only the **daemon's** registry construction becomes
  drop-in-aware. The daemon already has an async bootstrap (`main()` in
  `mesh-inbox-server.ts`), so one `await` there costs nothing. `resolveKindsForProfile`
  stays fully synchronous and untouched — a drop-in provider's kind/launch data does
  **not** get auto-merged (see "Explicitly deferred" below). The other ~29
  `createRegistryForProfile` call sites (CLI one-offs like `providers scan`, `switch`
  verification) are untouched too; they keep working exactly as today, just without
  drop-in providers in their local registry instance until they opt in later.

Net effect for a user: to get a fully-working custom CLI, they still write **both**
a `.sm/providers/kimi.mjs` (inject) **and** the `agents.kinds` yaml stanza from the
Kimi example doc (launch/kind-id recognition) — not the single-file "just drop it
in and everything works" ideal. That two-step reality should be stated plainly in
docs when this ships, not glossed over.

## File contract

- **Location**: `.sm/providers/*.mjs`. `.mjs` specifically (not `.js`) — a
  consumer project's own `package.json` `"type"` field is not guaranteed to be
  `"module"`, and `.mjs` is unambiguous regardless.
- **Export**: default export is an object matching `AgentProvider`
  (`packages/core/src/providers/types.ts`) — `id`, `detect`, `composerState`,
  `composerReady`, `injectPlan`, `sessionId`, `modelId`, `scrapePromptTurn` are
  required; `humanDraft`, `limits`, `kindBase`, `kindExtensions` stay optional,
  matching the existing interface exactly (no new parallel contract to maintain).
- **Validation at load time**: duck-type check that every required method exists
  and is a function. A file that fails to import (syntax error, missing export) or
  fails validation is **skipped with a logged warning** — it must never prevent the
  daemon from starting. Fail open, not closed.

## Error isolation (the part that actually matters for a shared daemon)

Once loaded, a drop-in provider's methods get called on **every pane scan tick** —
this is the real risk, not the file-loading step. Design:

- Wrap every method of a validated drop-in provider in a try/catch **at
  registration time** (one defensive wrapper object), not by trusting the many
  scattered call sites (`prov.detect(snap)` etc. appear across the daemon, tmux
  package, and CLI) to individually guard against a throwing provider.
- On a wrapped call throwing: return a safe fallback matching "nothing detected /
  idle" for that method (`detect` → `null`, `composerState` → `{phase:
  "plain_shell"}`, `composerReady` → `false`), and log **once per method per
  provider per 60s** (not every tick) — a provider that throws on every scan
  shouldn't spam the log into uselessness.
- **Explicitly not solved**: a synchronous infinite loop inside a drop-in
  provider's method hangs the daemon's single event loop — try/catch cannot catch
  that, and no cheap synchronous timeout mechanism exists in JS. This is an
  accepted risk, not a gap to silently paper over: `.sm/providers/*.mjs` is
  project-owned code, same trust boundary as `agents.runners` script paths and
  `layout.base.cli` launch commands the project already configures and trusts. It
  is not a new security boundary. Worth stating this plainly if/when this ships,
  not discovering it later when someone asks "what stops a bad provider from
  hanging the daemon?" — the honest answer is "nothing, same as any other project
  script."

## Explicitly deferred (not Phase 1)

- **Kind/launch auto-merge** — a drop-in provider's `kindBase()` feeding into
  `resolveKindsForProfile` automatically, so the user only needs the one `.mjs`
  file and no `agents.kinds` yaml stanza. Needs the sync/async bridge worked out
  properly (candidate: cache the drop-in kind data to a small JSON file once,
  asynchronously, at a point where writing it is convenient — daemon startup, or
  `sm reload` — and have `resolveKindsForProfile` read that file synchronously
  alongside the profile's own `agents.kinds` overlay; needs its own design pass,
  not decided here).
- **CLI-side registry adoption** (`providers scan`, `switch` provider verification,
  etc.) — lower value than the daemon (inject is what actually matters), can adopt
  the same loader incrementally once the daemon path is proven.
- **Hot-reload** of `.sm/providers/*.mjs` while the daemon is running — Phase 1
  loads once at daemon startup, same cadence as the rest of registry construction.
  A user changing a drop-in provider needs `inbox restart`, same as any other
  profile change today.

## Proposed TODO.md breakdown (not started)

- **6.1a** — Loader + validation + error-isolation wrapper
  (`packages/providers/src/dropin.ts` or similar): scan `.sm/providers/*.mjs`,
  import, validate, wrap, return `AgentProvider[]`. Unit-testable without touching
  the daemon (pure function over a directory of fixture files).
- **6.1b** — Wire into the daemon's registry construction only
  (`mesh-inbox-server.ts` bootstrap, one call site, one `await`). Prove end-to-end
  with a real `.sm/providers/*.mjs` fixture against a live daemon (not just unit
  tests) before calling this landed — same bar as the rest of this session's work.
- **6.1c** (separate, later) — kind/launch auto-merge (the deferred sync/async
  bridge above).
- **6.1d** (separate, later) — CLI-side registry adoption.

Do not implement 6.1a/6.1b without confirming this design with the operator first
— logged here per their explicit ask, not yet approved for implementation.

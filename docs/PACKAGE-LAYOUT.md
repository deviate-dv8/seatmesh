# Package layout (seat-mesh)

**Problem:** several packages dump dozens of `.ts` and `.test.ts` files in `src/` with no domain folders. Hard to navigate; tests look like product modules.

**North star:** one concern per directory; tests live **inside that directory** (or under `src/<domain>/*.test.ts`), never a flat sea at `src/*.test.ts` except re-export `index.ts`.

## Current snapshot (2026-09-14)

| Package | Flat `src/*.ts` (non-test) | Status |
|---------|---------------------------|--------|
| `@seat-mesh/daemon` | root: `index` + 2 entry scripts only | **DONE** — 39 files -> 11 domain folders |
| `seatmesh` (cli) | root: `main.ts` only | **DONE** — 21 files -> `commands/ setup/ report/ ui/` |
| `@seat-mesh/core` | root: `index.ts` only | **DONE** — loose modules -> `profile/` `paths/` `runtime/` |
| `@seat-mesh/tmux` | 2 flat | ok — `inject/`, `supervise/`, `comms/`, `seats/` (good pattern) |
| `@seat-mesh/providers` | small | ok — colocated tests |
| `@seat-mesh/connectivity` | small | ok |

**Good reference:** `packages/tmux/src/` — feature folders, tests beside the module (`inject/inject-draft.test.ts`).

**Root-kept entry files (intentional):** files located at runtime by a hardcoded dist path must
stay at `src/` root so their `dist/` path is unchanged: `@seat-mesh/daemon`'s
`mesh-inbox-server.ts` + `mesh-inbox-supervisor.ts` (found by `resolveDaemonScript` in
`@seat-mesh/core`, and the supervisor's HMR watch), and the CLI's `main.ts` (bin =
`dist/main.js`). Everything else nests.

## Rules (new / moved code)

1. **No new** production `.ts` at `packages/<pkg>/src/` except `index.ts` (barrel re-exports only).
2. **Tests** sit next to the module they cover: `foo/bar.ts` + `foo/bar.test.ts`, or `foo/__tests__/bar.test.ts`.
3. **Barrels:** each folder may export via `index.ts`; package root `src/index.ts` re-exports public API only.
4. **Names:** folder = domain (`peer/`, `store/`, `inject/`, `notify/`), not layer soup at one depth.

## `@seat-mesh/daemon` (phase 1 — DONE, commit 46f324f)

```
packages/daemon/src/
  index.ts                        barrel (public API)
  mesh-inbox-server.ts            entry (root — resolveDaemonScript)
  mesh-inbox-supervisor.ts        entry (root — HMR watch)
  orchestrator/   mesh-orchestrator, orchestrator, workers
  inject/         inject-delivery, compose-gate (+ tests)
  peer/           peer-backlog, peer-pending, peer-skip, peer-target-resolve, peer-comms-checkback (+ tests)
  store/          jsonl-store, sqlite-store, create-queue-store (+ tests)
  notify/         notify-act, notify-act-ui (+ test)
  checkback/      checkback-fire (+ test)
  connectivity/   connectivity-recovery, oc-resume, oc-resume-ack, cc-limit-retry (+ tests)
  inbox/          inbox-overload, delivery-hold, pane-ops-drain (+ tests)
  border/         border-paint
  queue/          bullmq-runtime
  state/          ppa-state
```

Imports: internal `../peer/peer-backlog.js`; public API unchanged via `daemon/src/index.ts`.

## `seatmesh` CLI (phase 2 — DONE, commit 46f324f)

```
packages/cli/src/
  main.ts                         entry (root — bin = dist/main.js)
  commands/   chat-cli, checkback-cli, contract-lock-cli, coord-cli, notify-cli,
              preview-cli, room-cli, seat-cli, sessions-cli
  setup/      init, agent-context-init, migrate-runtime, update (+ init test)
  report/     status-report, discovery-report
  ui/         banner, logo-art, logo-color, version-nudge (+ test)
```

Kept `templates/` and `profiles/` as today. Build/tooling scripts under `packages/*/scripts/`
are full TypeScript run via node type-stripping (`node scripts/bundle-profiles.ts`), not `.mjs`.

## `@seat-mesh/core` (phase 3 — DONE)

```
packages/core/src/
  index.ts                        barrel only at root
  profile/    profile, profile-edit (+ tests)
  paths/      paths, paths-manifest, runtime-paths, engine-paths (+ tests)
  runtime/    dotdir, global-registry, role-index, mesh-state-merge (+ tests)
  chatroom/ contracts/ messages/ layout/ schema/ …   (already nested)
```

`engine-paths.ts` lives under `paths/`; `seatMeshPackageRoot()` walks `../../../..` to the
seat-mesh repo root (one extra `..` vs the old root-src location). Public API unchanged via
`@seat-mesh/core` barrel.

## Migration process

1. One package per PR/commit; `npm run build && npm test` after each.
2. `git mv` only (history preserved); fix relative imports; run `tsc`.
3. No behavior change in layout PRs — refactor-only.
4. Optional: `scripts/check-flat-src.sh` — fail CI if `src/*.ts` count (excl. index) > 0.

## Verify

```bash
cd services/seat-mesh && npm run build && npm test
```

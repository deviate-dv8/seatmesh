# Package layout (seat-mesh)

**Problem:** several packages dump dozens of `.ts` and `.test.ts` files in `src/` with no domain folders. Hard to navigate; tests look like product modules.

**North star:** one concern per directory; tests live **inside that directory** (or under `src/<domain>/*.test.ts`), never a flat sea at `src/*.test.ts` except re-export `index.ts`.

## Current snapshot (2026-09-14)

| Package | Flat `src/*.ts` (non-test) | Tests at `src/` root | Subdirs already |
|---------|---------------------------|----------------------|-----------------|
| `@seat-mesh/daemon` | **~29** | **~13** | none (worst) |
| `seatmesh` (cli) | **~20** | 2 | `templates/` only |
| `@seat-mesh/core` | **~9** | **~6** | `chatroom/`, `contracts/`, `messages/`, … |
| `@seat-mesh/tmux` | 2 | 0 | `inject/`, `supervise/`, `comms/`, … (good pattern) |
| `@seat-mesh/providers` | small | colocated in module dirs | ok |
| `@seat-mesh/connectivity` | small | minimal | ok |

**Good reference:** `packages/tmux/src/` — feature folders, tests beside the module (`inject/inject-draft.test.ts`).

## Rules (new / moved code)

1. **No new** production `.ts` at `packages/<pkg>/src/` except `index.ts` (barrel re-exports only).
2. **Tests** sit next to the module they cover: `foo/bar.ts` + `foo/bar.test.ts`, or `foo/__tests__/bar.test.ts`.
3. **Barrels:** each folder may export via `index.ts`; package root `src/index.ts` re-exports public API only.
4. **Names:** folder = domain (`peer/`, `store/`, `inject/`, `notify/`), not layer soup at one depth.

## Target: `@seat-mesh/daemon` (phase 1)

```
packages/daemon/src/
  index.ts
  server/           mesh-inbox-server, mesh-inbox-supervisor
  orchestrator/     mesh-orchestrator, orchestrator, workers
  inject/           inject-delivery (+ test)
  gate/             compose-gate (+ test)
  peer/             peer-backlog, peer-pending, peer-skip, peer-target-resolve, peer-comms-checkback (+ tests)
  store/            jsonl-store, sqlite-store, create-queue-store (+ tests)
  notify/           notify-act, notify-act-ui (+ test)
  inbox/            inbox-overload (+ test)
  delivery/         delivery-hold (+ test)
  checkback/        checkback-fire (+ test)
  connectivity/     connectivity-recovery (+ test)
  oc/               oc-resume, oc-resume-ack (+ test)
  border/           border-paint
  pane-ops/         pane-ops-drain
  queue/            bullmq-runtime
  state/            ppa-state
  limit/            cc-limit-retry
```

Imports: internal `../peer/peer-backlog.js`; public API unchanged via `daemon/src/index.ts` (expand exports if needed).

## Target: `seatmesh` CLI (phase 2)

```
packages/cli/src/
  index.ts / main.ts
  commands/         checkback-cli, room-cli, notify-cli, seat-cli, …
  init/             init.ts, agent-context-init, migrate-runtime
  report/           status-report, discovery-report
  assets/           banner, logo-*
```

Keep `templates/` and `profiles/` as today.

## Target: `@seat-mesh/core` (phase 3)

Move loose root modules into existing or new folders:

- `profile.ts`, `profile-edit.ts` → `profile/`
- `paths.ts`, `paths-manifest.ts`, `runtime-paths.ts`, `engine-paths.ts` → `paths/`
- `dotdir.ts`, `global-registry.ts`, `role-index.ts`, `mesh-state-merge.ts` → keep or `runtime/`

## Migration process

1. One package per PR/commit; `npm run build && npm test` after each.
2. `git mv` only (history preserved); fix relative imports; run `tsc`.
3. No behavior change in layout PRs — refactor-only.
4. Optional: `scripts/check-flat-src.sh` — fail CI if `src/*.ts` count (excl. index) > 0.

## Verify

```bash
cd services/seat-mesh && npm run build && npm test
```

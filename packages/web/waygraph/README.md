# seatmesh hub — Waygraph E2E

Opinionated Playwright flows for the operator console, using
[`waygraph@0.7.4`](https://www.npmjs.com/package/waygraph).

Cross-mesh handout (engine API): zsign `.sm/seats/_shared/WAYGRAPH-HANDOUT.md`  
Consumer layout: zsign `.sm/seats/_shared/WAYGRAPH-CONSUMER-CONVENTION.md`

## Test environment

Waygraph tests bring their **own hub** — no manual `npm run web` required.

| File | Role |
|------|------|
| `../.env.waygraph` | Test hub env (`PORT=3191`, `NODE_ENV=test`, memory sessions) |
| `playwright.config.ts` | Boots hub via `webServer` + `globalSetup` session discovery |
| `scripts/global-setup.ts` | Picks first registry session id → `SEATMESH_WG_SESSION_ID` |

Default test origin: **`http://127.0.0.1:3191`** (dev hub on `:3190` stays separate).

### Prereqs

- Node 22+
- `npm install` in this folder
- `npx playwright install chromium` once
- At least one mesh session in the global registry (same as a normal hub)

### Commands

```bash
cd packages/web/waygraph
npm install
npm test                    # starts :3191 test hub, runs hubSmokeFlow

# against an already-running dev hub on :3190
npm run test:reuse
```

From repo root (prefer terminal pool — one Playwright at a time):

```bash
seatmesh agent tp run "npm run web:test" --summary "hub waygraph"
# result peers to your pane when done; other agents' TP jobs stay isolated
npm run web:test   # direct — ok for humans, not for parallel agents
```

Override session id:

```bash
SEATMESH_WG_SESSION_ID=2a311d npm test
```

Human step demo (hub must be reachable — use `test:reuse` or start `serve:waygraph`):

```bash
npm run demo:step
# or: npm run test:reuse -- --headed  # not defined; use demo:step with reuse env
SEATMESH_WG_REUSE=1 WAYGRAPH_BASE_URL=http://127.0.0.1:3190 npm run demo:step
```

## Adding routes

1. Mirror the Adonis path under `src/blocks/seatmesh-hub/` (see `SITE-MAP.md`).
2. Add `NAV.md` per route folder.
3. Nav-only route changes → `defineNavBlock`; clicks/forms → `*.action.block.ts`.
4. Wire a flow in `src/flows/` + `tests/*.spec.ts`.
5. Update `SITE-MAP.md`.

Local engine instead of npm (zsign monorepo): see zsign handout `file:` + `.npmrc` `install-links=true`.

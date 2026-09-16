# seatmesh hub — waygraph site map

Base URL: `http://127.0.0.1:3191` test hub (`.env.waygraph`); dev `:3190` via `test:reuse`

Namespace `seatmesh-hub/` mirrors Adonis routes (see `packages/web/start/routes.ts`).

```text
seatmesh-hub/                    /
  nav-hub-root.block.ts
  sessions/                      /sessions
    nav-sessions.block.ts
  sessions/_sessionId/config/    /sessions/:id/config (mem: SessionId)
    nav-session-config.block.ts
```

Flows: `src/flows/hub-smoke.flow.ts` (`hubSmokeFlow`).

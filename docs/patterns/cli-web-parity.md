# CLI ↔ web parity

**Surfaces:** CLI · web

## Hub lifecycle (`npx seatmesh web …`)

`@seat-mesh/web` is **private** (not on npm). `web up` needs a seatmesh git checkout (or `SEATMESH_WEB_ROOT`).

```bash
# from a seatmesh checkout (or any cwd that walk-ups to one)
npx seatmesh web up              # start :3190 detached
npx seatmesh web status          # hub up? + daemon + routes
npx seatmesh web down            # stop
npx seatmesh web restart --open  # bounce + open browser
npx seatmesh web open            # alias: open-web
npx seatmesh web url /sessions   # print URL only

# same from global install if SEATMESH_WEB_ROOT is set:
export SEATMESH_WEB_ROOT=/path/to/seatmesh/packages/web
seatmesh web up
```

Also: `npm run web` (repo root, foreground HMR).

| Env | Role |
|-----|------|
| `SEATMESH_WEB_URL` | Hub base (default `http://127.0.0.1:3190`) |
| `SEATMESH_WEB_ROOT` | Absolute path to `packages/web` |
| `SEATMESH_ROOT` | Seatmesh repo root (`…/packages/web` derived) |

Pid/log: `~/.config/seatmesh/web-<port>.{pid,log}`

## Hub routes

| What | CLI | Web (`:3190`) |
|------|-----|----------------|
| Dashboard / sessions | `sm sessions` · `sm web status` | `/` · `/sessions` |
| Start / stop hub | `sm web up\|down\|restart` | — |
| Open hub in browser | `sm web open` · `sm open-web` | — |
| Hub URL only | `sm web url [/path]` | — |
| This mesh daemon | `sm report` · `sm inbox` · `sm web status` | `/sessions/:id` · `/sessions/:id/ops` |
| Restart inbox | `sm inbox restart` | `/sessions/:id/ops` → inbox restart |
| Queues / ACKs / CBs | `sm agent hub` · `sm agent cb list` | `/sessions/:id/queues` |
| Terminals | `sm session attach` · panes | `/sessions/:id/terminals` |
| Config | `sm config check` · `sm config upgrade` | `/sessions/:id/config` |
| Notifications | `sm agent notify …` | `/notifications` · hub `/act/card/:id?port=` |
| Tools / MDs | `sm agent mds hosted\|agent-self\|agent <kind>` · `sm agent preview` (mdview.io) | `/mds` · `/mds/:session/:slug` |

## Rules

1. **CLI must not trail the hub** for status/restart discoverability — prefer `sm web status` / `sm web up` over “find the README”.
2. Hub default URL: `http://127.0.0.1:3190` (`SEATMESH_WEB_URL` override).
3. Start hub: `npx seatmesh web up` (detached) or `npm run web` (foreground).
4. Pane status verb `sm status <target> <text>` is **tmux @mesh_status** — not hub status. Hub = `sm web status`.

## Gaps (track here)

| Gap | Notes |
|-----|-------|
| Act/card from CLI | notify already opens cards; deep-link via `web open /act/card/…` |
| Live terminal send | web POST terminals/send — CLI stays attach/tmux |
| Multi-mesh dashboard | `web status` lists `~/.config/seatmesh/sessions.json` |
| Publish `@seat-mesh/web` | still private — lifecycle CLI requires checkout |

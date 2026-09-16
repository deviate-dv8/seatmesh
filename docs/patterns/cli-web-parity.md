# CLI ↔ web parity

**Surfaces:** CLI · web

## Hub

| What | CLI | Web (`:3190`) |
|------|-----|----------------|
| Dashboard / sessions | `sm sessions` · `sm web status` | `/` · `/sessions` |
| Open hub in browser | `sm web open` · `sm open-web` | — |
| Hub URL only | `sm web url [/path]` | — |
| This mesh daemon | `sm report` · `sm inbox` · `sm web status` | `/sessions/:id` · `/sessions/:id/ops` |
| Restart inbox | `sm inbox restart` | `/sessions/:id/ops` → inbox restart |
| Queues / ACKs / CBs | `sm agent hub` · `sm agent cb list` | `/sessions/:id/queues` |
| Terminals | `sm session attach` · panes | `/sessions/:id/terminals` |
| Config | `sm config check` · `sm config upgrade` | `/sessions/:id/config` |
| Notifications | `sm agent notify …` | `/notifications` · `/act/card/:id` |
| Tools / MDs | — | `/tools` · `/mds` |

## Rules

1. **CLI must not trail the hub** for status/restart discoverability — prefer `sm web status` over “find the README”.
2. Hub default URL: `http://127.0.0.1:3190` (`SEATMESH_WEB_URL` override).
3. Start hub from checkout: `npm run web` (packages/web).
4. Pane status verb `sm status <target> <text>` is **tmux @mesh_status** — not hub status. Hub = `sm web status`.

## Gaps (track here)

| Gap | Notes |
|-----|-------|
| Act/card from CLI | notify already opens cards; deep-link via `web open /act/card/…` |
| Live terminal send | web POST terminals/send — CLI stays attach/tmux |
| Multi-mesh dashboard | `web status` lists `~/.config/seatmesh/sessions.json` |

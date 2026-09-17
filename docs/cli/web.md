# seatmesh web

```text
web status|up|down|restart|open|url|help
  Operator hub (packages/web) on http://127.0.0.1:3190 — dashboard / sessions / queues / notify cards.
  Subcommands:
    status [--json]     hub up? + pid/log + daemon tips + routes + registry
    up [--open]         start hub detached (npm run dev in packages/web)
    down                stop hub (pidfile + :3190 listeners)
    restart [--open]    down then up
    open [path]         open hub in browser (alias: open-web)
    url [path]          print hub URL only
  npx / global:
    npx seatmesh web up
    npx seatmesh web status
    npx seatmesh web down
    npx seatmesh web restart --open
  Needs a seatmesh checkout (@seat-mesh/web is private — not on npm).
  Resolves packages/web via: cwd walk-up · SEATMESH_WEB_ROOT · SEATMESH_ROOT · CLI monorepo neighbor.
  Env: SEATMESH_WEB_URL (hub base) · SEATMESH_WEB_ROOT · SEATMESH_ROOT
  Pid/log: ~/.config/seatmesh/web-<port>.{pid,log}
  Also: npm run web (repo root). Map: docs/patterns/cli-web-parity.md · docs/cli/web.md
```

- CLI: `seatmesh web --help`
- Agent: `seatmesh agent help web`
- Catalog: [../COMMANDS.md#web](../COMMANDS.md#web)
- Aliases: `open-web`

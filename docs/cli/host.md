# seatmesh host

```text
host up|down|status
  Opt-in single host-supervisor: one process watches all meshes registered in
  ~/.config/seatmesh/sessions.json instead of each spawning its own supervisor.
  Does not affect meshes that haven't opted in (Phase 1, see NOW.md).
```

- CLI: `seatmesh host --help`
- Agent: `seatmesh agent help host`
- Catalog: [../COMMANDS.md#host](../COMMANDS.md#host)

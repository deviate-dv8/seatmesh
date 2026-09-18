# seatmesh reload

```text
reload|rebuild [--layout]
  Rebuild seatmesh packages (npm build) + refresh labels/borders/inbox.
  Does NOT re-read config into live agents / does NOT replace pane CLIs
  (that is spawn/switch/coordSync). --layout re-grids (disruptive).
  Prefer vocal: rebuild
```

- CLI: `seatmesh reload --help`
- Agent: `seatmesh agent help reload`
- Catalog: [../COMMANDS.md#reload](../COMMANDS.md#reload)
- Aliases: `rebuild`

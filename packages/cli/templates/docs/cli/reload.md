# seatmesh reload / rebuild

```text
reload|rebuild [--layout]
  Rebuild seatmesh packages (npm build) + refresh labels/borders/inbox.
  Does NOT re-read config into live agents / does NOT replace pane CLIs
  (that is spawn/switch/coordSync). --layout re-grids (disruptive).
  Prefer vocal: rebuild
```

- CLI: `seatmesh rebuild --help` · `seatmesh reload --help`
- Agent: `seatmesh agent help rebuild`
- Catalog: [../COMMANDS.md#reload](../COMMANDS.md#reload)

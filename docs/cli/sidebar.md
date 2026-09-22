# seatmesh sidebar

```text
sidebar [--once] [--interval SEC]
  Auto-refreshing terminal overview of every registered mesh + which agent is
  live in each pane (TODO 10.2, first minimal version — not the final
  interactive form). Works from anywhere, no .sm/ workspace needed.
  --once: print one snapshot and exit (scripting). --interval: refresh
  seconds, default 5. Ctrl+C to exit.
```

- CLI: `seatmesh sidebar --help`
- Agent: `seatmesh agent help sidebar`
- Catalog: [../COMMANDS.md#sidebar](../COMMANDS.md#sidebar)

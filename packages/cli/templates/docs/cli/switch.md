# seatmesh switch

```text
switch <target> <agent|claude|opencode|kiro|empty> [flags] [reason...]
  Replace a LIVE agent CLI (or → empty shell). Empty pane → prefer spawn.
  Alias: handoff. Empty→CLI alias: spawn. See: seatmesh help human
  Examples: switch slot-1 claude · switch here agent · switch mini-2 empty
  Flags: --keep-resume --resume ID --queue
```

- CLI: `seatmesh switch --help`
- Agent: `seatmesh agent help switch`
- Catalog: [../COMMANDS.md#switch](../COMMANDS.md#switch)
- Related: [spawn.md](spawn.md) · [human.md](human.md)

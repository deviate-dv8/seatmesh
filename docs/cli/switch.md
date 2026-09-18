# seatmesh switch

```text
switch <target|1..4> <agent|claude|opencode|kiro|empty> [flags] [reason...]
  Replace a LIVE agent CLI (or → empty). Empty pane → prefer spawn (--fast).
  Alias: handoff. Flags: --fast (skip verify) --slow --keep-resume --resume ID --queue
  Examples: switch slot-1 claude · switch here agent --fast
```

- CLI: `seatmesh switch --help`
- Agent: `seatmesh agent help switch`
- Catalog: [../COMMANDS.md#switch](../COMMANDS.md#switch)
- Aliases: `cc`, `handoff`

# seatmesh switch

```text
switch <target> <agent|claude|opencode|kiro|empty> [flags] [reason...]
  HUMAN: empty terminal → agent CLI (or empty = back to shell).
  Alias: handoff. See: seatmesh help human
  Examples: switch slot-1 opencode · switch here claude · switch mini-2 empty
  Flags: --keep-resume --resume ID --queue
```

- CLI: `seatmesh switch --help`
- Agent: `seatmesh agent help switch`
- Catalog: [../COMMANDS.md#switch](../COMMANDS.md#switch)
- Aliases: `cc`, `handoff`

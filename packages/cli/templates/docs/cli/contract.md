# seatmesh contract

```text
contract [status|on|off|open]
  Simple harness locks — one path for agents (prefer over apply / raw supervise).

  status                 show supervise/balance ON|OFF
  on [supervise|balance] arm lock + room + tick (default: supervise)
  off [supervise|balance]
  open <slug> --scope "…"   named room (CLAIMED/DONE) — not a lock

  Examples:
    seatmesh agent contract
    seatmesh agent contract on
    seatmesh agent contract on balance
    seatmesh agent contract off
    seatmesh agent contract open slice-a --scope "landing CTA"

  Day-to-day work: todo give / peer / room — contracts optional.
  (agent apply … still works for power users; prefer contract on/off.)
```

- CLI: `seatmesh contract --help`
- Agent: `seatmesh agent help contract`
- Catalog: [../COMMANDS.md#contract](../COMMANDS.md#contract)

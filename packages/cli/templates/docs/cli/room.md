# seatmesh room

```text
room tail [-r slug] [-n N] | room say [-r slug] "<msg>"
  Modern path: say/tail (+ contract open <slug> for named ledgers).
  Prefer CLAIMED|DONE|FYI|STATUS lines over room call/accept (legacy A2A dial).
  Also: room broadcast <msg> | room read | room create <slug>
  Legacy: room call|accept|decline|pending (workers) — prefer peer ask/msg instead
  Global default; -r managers|supervise
  broadcast/say fan-out = daemon queue (POST /room-fanout)
```

- CLI: `seatmesh room --help`
- Agent: `seatmesh agent help room`
- Catalog: [../COMMANDS.md#room](../COMMANDS.md#room)

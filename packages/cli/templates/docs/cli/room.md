# seatmesh room

```text
room tail [-r slug] [-n N] [--truncate N] [--json] | room get <id> [--json]
  room say [-r slug] "<msg>"  (same sender+body within ~20s is deduped, not re-sent)
  room broadcast <msg> | room read | room call|accept …
  A2A ledger. Global default; -r managers|supervise
  broadcast/say fan-out = daemon queue (POST /room-fanout) — not direct-inject storm
```

- CLI: `seatmesh room --help`
- Agent: `seatmesh agent help room`
- Catalog: [../COMMANDS.md#room](../COMMANDS.md#room)

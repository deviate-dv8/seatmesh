# seatmesh peer

```text
peer <target> "<msg>" [--ack|--ended [id]] [--direct]
  Enqueue mesh mail to manager|secretary|slot-N|mini-N.
  Cross-mesh: peer @alias:seat "…"  (or: remote <alias> <seat> "…")
  --ack / --ended [id]  close open ask (bare --ack auto-matches)
  ACK/FYI/PROG bodies auto --ack. peer verify [target]
  Shorthands (all agents): ask|msg|tell <t> "…" · ackmsg <t> "…" · reply <id> [msg]
```

- CLI: `seatmesh peer --help`
- Agent: `seatmesh agent help peer`
- Catalog: [../COMMANDS.md#peer](../COMMANDS.md#peer)

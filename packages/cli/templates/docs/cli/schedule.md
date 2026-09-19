# seatmesh schedule

```text
schedule <target> "<msg...>" --at <time>
  Delayed one-shot peer — queues now, held out of drain until --at passes
  (ISO time or relative duration: 10m, 2h, 1d). Fire-and-forget: no ACK
  tracking opens until it's actually delivered.
  Examples: schedule secretary "EOD digest" --at 6h · schedule slot-2 "follow up" --at 2026-09-20T09:00:00Z
```

- CLI: `seatmesh schedule --help`
- Agent: `seatmesh agent help schedule`
- Catalog: [../COMMANDS.md#schedule](../COMMANDS.md#schedule)

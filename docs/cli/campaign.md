# seatmesh campaign

```text
campaign create <title> [--objective "..."] [--assign <seat>] [--json]
  campaign list [--status open|done|cancelled|all] [--json]
  campaign show <id> [--json]
  campaign assign <id> <seat>
  campaign done|cancel|reopen <id>
  campaign note <id> "<text>"
  Ticket-style campaigns (TODO 8.2/8.4) — one atomic work unit: title, objective
  (what "done" means), status, optional assignee, freeform notes. Purely additive,
  its own event log — no dependency graph, no supervisor/balancer roles yet.
```

- CLI: `seatmesh campaign --help`
- Agent: `seatmesh agent help campaign`
- Catalog: [../COMMANDS.md#campaign](../COMMANDS.md#campaign)

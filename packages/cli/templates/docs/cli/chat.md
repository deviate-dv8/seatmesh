# seatmesh chat

```text
chat tail [--slot key] [--lines N] [--json]
  chat query [--slot|--session|--model|--since|--limit] [--json]
  chat put <slot> "<human>" [--response "<text>"]  (positional upsert, dedupe by turnHash)
  chat get <id> [--slot key] [--json]  (id or turnHash, full or 8-char prefix)
  chat append|record  — per-slot prompt/response CHAT.jsonl
```

- CLI: `seatmesh chat --help`
- Agent: `seatmesh agent help chat`
- Catalog: [../COMMANDS.md#chat](../COMMANDS.md#chat)

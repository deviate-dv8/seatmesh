# seatmesh preview

```text
preview <file.md...> [--set 1-30] [--notify]
  Publish markdown to mdview.io (https://mdview.io) — NOT a local binary.
  Renders MD + Mermaid in the browser; prints viewerUrl.
  Local hub gallery: mds hosted host <file.md> → .sm/mds + /mds URL
  Examples:
    preview ./handout.md --set 7
    preview ./handout.md --set 7 --notify
  Also: notify info|md "<title>" --md <file>  (same publish, toast+card)
  Docs: https://mdview.io/agents · API POST https://mdview.io/api/public/publish
```

- CLI: `seatmesh preview --help`
- Agent: `seatmesh agent help preview`
- Catalog: [../COMMANDS.md#preview](../COMMANDS.md#preview)

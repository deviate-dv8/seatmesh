# seatmesh layout

```text
layout [--no-leads] [--dry-run] [--yes]
  layout reload [--yes] [--no-leads] [--no-resume]
  layout scale workers|minis up|down|<N> [--yes] [--dry-run]
  layout column list|add <id> [--cli P] [--after ID] [--co-typed]|remove <id>
  Relayout + repair panes from mesh-agents.json (resume). Scale + columns.
  Auto: layout.autoScale.enabled in mesh.config.yaml
```

- CLI: `seatmesh layout --help`
- Agent: `seatmesh agent help layout`
- Catalog: [../COMMANDS.md#layout](../COMMANDS.md#layout)

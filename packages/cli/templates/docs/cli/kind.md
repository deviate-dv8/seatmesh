# seatmesh kind

```text
kind <target>  |  kind list  |  kind show <id>
  <target>: agent CLI vs plain terminal (aliases: what, typeof)
  list/show: dump resolved agent kinds (provider kindBase ⋂ agents.kinds overlay
  ⋂ runners shim, extends flattened) — DX for custom-profile kinds
```

- CLI: `seatmesh kind --help`
- Agent: `seatmesh agent help kind`
- Catalog: [../COMMANDS.md#kind](../COMMANDS.md#kind)
- Aliases: `typeof`, `what`

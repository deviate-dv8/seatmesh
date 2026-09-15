# seatmesh remote

```text
remote [--json]
  remote <alias> <seat> "<msg>"
  remote @alias:seat "<msg>"
  Cross-mesh: list other sessions OR peer another mesh.
  Alias: meshes
  Needs remotes.<alias>.profile in mesh.config.yaml (see agent remote / sessions).
  Examples:
    remote
    remote pia secretary "FYI: …"
    remote @pia:secretary "FYI: …"
```

- CLI: `seatmesh remote --help`
- Agent: `seatmesh agent help remote`
- Catalog: [../COMMANDS.md#remote](../COMMANDS.md#remote)
- Aliases: `meshes`

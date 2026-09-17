# seatmesh update

```text
update [--dry-run] [--migrate] [--no-restart-inbox]
  TWO STEPS — bump the CLI first, then refresh this mesh profile:
    1) npm install -g seatmesh@latest     # or: npx seatmesh@latest …
    2) seatmesh update                    # sync .sm/_vendor from that CLI
  Step 2 alone does NOT upgrade npm. Guide: seatmesh config upgrade
  Also: merge new mesh.config keys; seed seats/_shared; role-pack; paths.json.
  --migrate: legacy tasks/ → .sm/runtime
```

- CLI: `seatmesh update --help`
- Agent: `seatmesh agent help update`
- Catalog: [../COMMANDS.md#update](../COMMANDS.md#update)

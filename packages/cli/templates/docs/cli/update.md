# seatmesh update

Two steps — **upgrade the CLI first**, then refresh this mesh profile.

```text
1) npm install -g seatmesh@latest
   # or one-shot: npx seatmesh@latest update
2) seatmesh update [--dry-run] [--migrate] [--no-restart-inbox]
```

`update` alone does **not** bump npm. It syncs `.sm/_vendor` from the CLI you ran.
Guide: `seatmesh config upgrade`

```text
update [--dry-run] [--migrate] [--no-restart-inbox]
  1) npm i -g seatmesh@latest
  2) refresh _vendor + AGENTS.md; merge new mesh.config keys; seed seats/_shared;
     role-pack migrate; paths.json. --migrate also legacy tasks/ → .sm/
```

- CLI: `seatmesh update --help` · `seatmesh config upgrade`
- Agent: `seatmesh agent help update`
- Catalog: [../COMMANDS.md#update](../COMMANDS.md#update)

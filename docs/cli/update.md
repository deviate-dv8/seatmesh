# seatmesh update

Two steps — **upgrade the CLI first**, then refresh this mesh profile.

```text
1) npm install -g seatmesh@latest
   # or one-shot: npx seatmesh@latest update
2) seatmesh update [--dry-run] [--migrate] [--no-restart-inbox]
```

`update` alone does **not** bump npm. It syncs `.sm/_vendor`, merges missing
config keys, seeds `seats/_shared`, role-pack migrate, and `paths.json` from
**whatever CLI binary you ran**.

Guide: `seatmesh config upgrade` · validate: `seatmesh config check`

```text
update [--dry-run] [--migrate] [--no-restart-inbox]
  1) npm i -g seatmesh@latest
  2) refresh _vendor + AGENTS.md; merge new mesh.config keys; seed seats/_shared;
     role-pack migrate; paths.json. --migrate also legacy tasks/ → .sm/
```

- CLI: `seatmesh update --help` · `seatmesh config upgrade`
- Agent: `seatmesh agent help update`
- Catalog: [../COMMANDS.md#update](../COMMANDS.md#update)

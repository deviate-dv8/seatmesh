# seatmesh mds

```text
mds [hosted|agent-self|agent <kind>] …
  Three markdown galleries (CLI ↔ hub /mds):
    hosted [list] | host <file.md> [--as slug] | show|url <slug>
      → .sm/mds/ live files; hub http://127.0.0.1:3190/mds
    agent-self [list] | show <FOCUS.md|TASKS|_shared/…> [--seat col]
      → this seat's FOCUS/TASKS/REMINDER + .sm/seats/_shared
    agent <common|manager|secretary|worker|mini> [show]
      → locked role POV under .sm/roles/_vendor/docs/
  Bare mds / mds status = counts. mdview.io share stays: agent preview <file.md>
  Map: docs/patterns/cli-web-parity.md · docs/cli/mds.md
```

- CLI: `seatmesh mds --help`
- Agent: `seatmesh agent help mds`
- Catalog: [../COMMANDS.md#mds](../COMMANDS.md#mds)

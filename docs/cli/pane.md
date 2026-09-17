# seatmesh pane

```text
pane resume [target]
  Autodetect original session id on the pane and resume it.
  Sources: live cmdline → @mesh_oc_session → scrollback → mesh-agents.
  Live OpenCode: paste resume [ses_…]. Else relaunch opencode-cpe/opencode/claude with that id.
  Default target: here. Examples: pane resume · pane resume secretary
```

- CLI: `seatmesh pane --help`
- Agent: `seatmesh agent help pane`
- Catalog: [../COMMANDS.md#pane](../COMMANDS.md#pane)

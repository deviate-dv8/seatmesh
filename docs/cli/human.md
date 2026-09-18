# seatmesh human

```text
human — put an agent CLI on a pane (operator)

  Empty terminal → agent (prefer spawn; **fast by default**):
    spawn <target|1..4> <opencode|opencode-cpe|claude|agent|kiro>
    Examples:
      seatmesh spawn slot-1 opencode
      seatmesh spawn 1..3 opencode-cpe
      seatmesh spawn here agent --slow   # wait verify + FRESH SUMMON

  Replace a live agent:
    switch <target> <cli> [--fast] [reason...]
      seatmesh switch here agent --fast

  Back to plain shell (saves empty in mesh-agents.json):
    kill <target>     # alias: empty
    switch <target> empty --fast

  Start/resume the seat's configured CLI (no type pick):
    launch <target|all|manager|secretary>

  Resume known session on a pane (autodetect ses_* / resume id):
    pane resume [here|secretary|slot-N|…]

  Check agent vs shell:
    kind <target>     # aliases: what | typeof

  Give the seat WORK / a todo (does NOT install a CLI — different from spawn/switch):
    todo give <target> "do the thing"     # preferred
    todo <target> "do the thing"          # shorthand
    assign <target> "do the thing"        # same engine

  Targets: manager | secretary | slot-N | mini-N | here
  Operator help: seatmesh help (human) · seatmesh --agents help (full)
  Aliases for this topic: help put-agent | help panes | help operator
```

- CLI: `seatmesh human --help`
- Agent: `seatmesh agent help human`
- Catalog: [../COMMANDS.md#human](../COMMANDS.md#human)
- Aliases: `operator`, `panes`, `put-agent`

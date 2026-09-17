# seatmesh human

```text
human — put an agent CLI on a pane (operator)

  Empty terminal → agent:
    switch <target> <opencode|opencode-cpe|claude|agent|kiro>
    Examples:
      seatmesh switch slot-1 opencode
      seatmesh switch secretary opencode-cpe --keep-resume
      seatmesh switch here agent          # this pane (Cursor)
      seatmesh switch mini-1 opencode-cpe --keep-resume

  Back to plain shell:
    switch <target> empty

  Start/resume the seat's configured CLI (no type pick):
    launch <target|all|manager|secretary>

  Resume known session on a pane (autodetect ses_* / resume id):
    pane resume [here|secretary|slot-N|…]

  Check agent vs shell:
    kind <target>     # aliases: what | typeof

  Give the seat WORK / a todo (does NOT install a CLI — different from switch):
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

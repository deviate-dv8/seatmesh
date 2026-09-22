# seatmesh sessions

```text
sessions [--json]
  List other seatmesh meshes (registry + live tmux): dir, port, daemon, peer @alias.
  sessions kill <id|label|sessionName|profilePath|workspace> [--keep-inbox]
    Kill any registered session by name — no need to cd/--profile into it
    first, or attach in tmux just to kill it. Aliases: stop, down.
  Agent: list only. Operator: sessions attach|forget|register|pick|kill (no agent).
  Prefer: remote (list + send in one verb)
```

- CLI: `seatmesh sessions --help`
- Agent: `seatmesh agent help sessions`
- Catalog: [../COMMANDS.md#sessions](../COMMANDS.md#sessions)

# Parallel run (internal)

Historical note for workspaces that still run a legacy tmux harness beside
seatmesh. **Not required reading** for new adopters — see [README.md](README.md).

# Parallel run: seatmesh vs legacy harness

## seatmesh is NOT a harness plugin

**Wrong mental model:** "`sm` is how you run legacy harness" / "sm wraps dev" /
"sm is a thin alias for `./legacy harness`."

**Correct:** seatmesh is a **separate** tmux workbench. It has its own session
name (`mesh` in the default profile), its own layout (see `ARCHITECTURE.md`), its
own pane options (`@mesh_*`), and its own CLI (`whoami`, `room`, `session`, …).

`legacy harness` is the **legacy consumer harness** for session `dev` (8 workers,
manager, inbox, mini spawn, board triage, etc.). It does not load
`mesh.config.yaml` and seatmesh does not source it.

```text
  sm                    ./legacy harness
       |                            |
       v                            v
  seatmesh CLI                bash harness
       |                            |
       v                            v
  tmux session "mesh"          tmux session "dev"
  (profile layout)             (tmux-main-agents.json)
```

Both can exist on one machine. **Do not merge entrypoints.** No `exec`
legacy harness from retired `./sm.sh`. No dual-write linker in the harness unless a
documented migration step says so.

## Only shared passthrough

| External command | Who calls it | Why |
|------------------|--------------|-----|
| `./dc.sh` | `sm stack` / `dc` | Profile `stack.command` — docker/worktrees, not tmux |

Nothing else from the harness is passthrough. Not `prompt`, not `mini`, not
`inbox`, not `attach` to `dev`.

## Command map

| Concern | Legacy harness (`legacy harness`, session `dev`) | seatmesh (`sm`, session `mesh`) |
|---------|-----------------------------------------------|---------------------------------------|
| Attach / create session | `./legacy harness` | `sm` or `sm session attach` |
| Seat identity | `./legacy harness whoami` (harness) | `sm whoami` (`@mesh_*` + role index) |
| Inbox | `:3099` mature (list/resolve/backlog) | `:3100` enqueue ok; **list/resolve gap** |
| prompt / remind / flush / switch | yes | yes (enqueue → daemon) |
| mini / secretary | yes (bash) | yes (`minis.ts`, secretary dispatch/collect) |
| room broadcast / tail | — | **yes** |
| peek | — | **yes** |
| night / continue / triage | harness | harness-only (see SURPASS.md) |
| Stack / docker | `./dc.sh` directly | `sm stack` → `./dc.sh` |

**Surpass plan:** [SURPASS.md](SURPASS.md)

## Cutover (later)

Per-command migration: producers enqueue; daemon injects; harness commands shrink.
Until then, agents on **dev** follow `.agent/` harness docs; agents on **mesh**
follow seatmesh profile + role index.

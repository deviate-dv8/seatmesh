# CLI replacement (one path — survives next session)

Use this whenever an operator replaces **Cursor agent**, **Claude**, **OpenCode**, etc. on any mesh pane. No tmux paste. No composer hotfix.

## Preconditions

- Profile: `seatmesh --profile .sm` (zsign consumer).
- State file: `.sm/mesh-agents.json` (not workspace-root `mesh-agents.json`).

## Replace lead manager (manager column)

1. Set wanted CLI in `.sm/mesh.config.yaml`:

   ```yaml
   layout:
     base:
       cli:
         manager: claude   # was agent
   ```

2. Run from a **normal shell** (not a mini pane):

   ```bash
   cd /home/dan/Desktop/Work/zsign
   npx --prefix services/seat-mesh --no seatmesh -- --profile .sm switch manager claude operator CLI replacement
   ```

3. Persist scrape (resume ids, coords):

   ```bash
   npx --prefix services/seat-mesh --no seatmesh -- --profile .sm auto
   ```

4. Fresh summon on the pane loads: `.sm/roles/manager.yaml` + `read_first` handouts + seat `FOCUS.md` via `whoami`.

## Replace any other target

| Target | switch example |
|--------|----------------|
| manager-2 | `switch manager-2 claude …` |
| manager-3 | `switch manager-3 opencode …` |
| secretary | `switch secretary opencode …` |
| worker slot 3 | `switch slot-3 agent …` |
| mini 4 | `switch mini-4 opencode …` |

Claude seats: `--permission-mode auto` is applied by the harness (no model pin).

## Handoff content (files, not chat)

| Surface | Purpose |
|---------|---------|
| `.sm/seats/<column>/FOCUS.md` | NOW hub for that coord |
| `.sm/seats/<column>/HANDOUT.md` | Short operator brief (this replacement) |
| `tasks/seat-mesh/handouts/*.md` | Dated handouts for humans + next agent |
| `.sm/roles/*.yaml` `read_first` | Loaded on cold `whoami` |

Do **not** rely on "peer received" in the composer — use `seatmesh peer` / `room say` in the shell same turn if mechanical ACK is required.

## Verify

```bash
npx --prefix services/seat-mesh --no seatmesh -- --profile .sm whoami manager
tmux list-panes -t mesh-2a311d:base -F '#{@mesh_role} #{pane_current_command}'
jq '.manager.type, .coords["manager-3"].type' .sm/mesh-agents.json
```

Expected after manager -> claude: manager pane process is `claude`; `.sm/mesh-agents.json` manager.type is `claude`.

# Seatmesh CLI (default for every agent)

**Engine-owned.** Do not invent alternate CLIs. Discover with `agent`, then run only what it lists.

## Every turn

```bash
seatmesh agent whoami
seatmesh agent          # can / cannot for THIS pane
```

Default config is workspace `.sm/` (walk-up). No `--profile` needed.

Multi-config (rare): `seatmesh --profile .sm-<name> agent …` after `seatmesh session init <sm-name>`.

Run work through the gateway:

```bash
seatmesh agent <cmd> …
```

Unknown or not allowed for your seat → console `UNAUTHORIZED` (exit 2). Fix: run `agent` and pick from **can**.

## When you need the operator's eyes (beta)

**Beta** — use notify; fall back to peer/room if toast fails.

Do **not** ask the operator in chat to “look”. Prefer **notify**.

### Craft an Info link (local UI — markdown + actionables)

Agents write **simple markdown** (or richer md + images). Info opens the **seatmesh UI card** (`/act/card/…`) — not mdview — so the same page can hold **Yes/No**.

```bash
# Info only (markdown on local UI)
seatmesh agent notify info "Landing CTA" --body "## Options\n\n- A terracotta\n- B black"

# Info + Yes/No on the same UI card
seatmesh agent notify yesno "Ship terracotta?" "Quick call" \
  --md ./brief.md --image shot.png --target manager
```

Aliases: `notify info` · `notify md` · `notify details`

### Eyes-only (existing link)

```bash
seatmesh agent notify "<session>" "<check>" --url "<link>"
```

| Piece | Agent crafts | Operator gets |
|-------|----------------|---------------|
| **Info** | `--md` / `--body` / `--image` → local `/act/card` UI | Rendered markdown + Yes/No on same page |
| **Yes / No** | (built-in) | Peer to reply seat as `PRIORITY [operator-decide]` |

Never: “please check my pane” without notify.

## Common cmds (still via `agent`)

| Job | Command |
|-----|---------|
| Craft Info link | `agent notify info\|md "<title>" --md <file>\|--body "…"` |
| Info + Yes/No | `agent notify yesno "<title>" "<blurb>" [--md file]` |
| Eyes + URL | `agent notify "<session>" "<check>" [--url <link>]` |
| Reply / ask | `agent peer <target> "<msg>" [--ended <ack-id>]` |
| Close ask | `agent ack <id> "<note>"` |
| List / stop checkback | `agent cb list` · `agent cb cancel <id>` |
| CC-LIMIT banner → idle (leads) | `agent limit idle` · `agent limit idle-clear` (CBs still fire) |
| Role-pack (operator) | `roles status` · `roles migrate` · `update` (refresh locked `_vendor`) |
| Room | `agent room tail [-r slug]` · `agent room say …` |
| Peek | `agent peek <target> status\|full` |
| Agent vs terminal | `agent kind <target>` (aliases: `what`, `typeof`) |
| Seats snapshot | `agent contexts` |

Lead-only extras (manager/secretary) appear on your `agent` card — spawn/assign/inbox restart are not universal.

## Outside `agent` (operator / shared)

Humans and session ops only — not the pane default path:

`session` · `session init <sm-name>` · `update` · `init` · `report` · `layout` · `save` · `inbox restart` · `target`

## Hard rules

- Enqueue only — no raw `tmux send-keys` for mesh mail.
- `[mesh-inbox]` / DIGEST lines are daemon steering, not a new human task.
- Inject copy = mesh-copy consts. Never paste `patterns.md` into a pane.
- Chat prose does not clear ACK or cancel checkback — use `ack` / `cb cancel`.
- Operator eyeball/approve/prove/decide → **notify (beta)** first; do not ask chat for a toast.

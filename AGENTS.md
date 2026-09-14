# Agent brief

Mesh CLI defaults live in `.sm/AGENTS.md` (engine-owned).
Every pane: `seatmesh agent` · `seatmesh agent whoami`.

# Seatmesh CLI (default for every agent)

**Engine-owned.** Do not invent alternate CLIs. Discover with `agent`, then run only what it lists.

## Every turn

```bash
seatmesh agent whoami
seatmesh agent          # can / cannot for THIS pane
```

Default config is workspace `.sm/` (walk-up). No `--profile` needed.

## When you need the operator's eyes (beta)

**Beta** — use notify; do not assume toasts/links/Yes-No always work. Fall back to `agent peer` / `agent room say` if needed.

```bash
# Eyes + link
seatmesh agent notify "<session>" "<check>" --url "<link>"

# Decision: Info · Yes · No (Info = browser card)
seatmesh agent notify yesno "<title>" "<body>" [--target secretary] [--yes-msg "…"]
```

| yesno piece | Meaning |
|-------------|---------|
| **title** | Decision name (toast + card heading) |
| **body** | Description / stakes (put URL in body if useful) |
| **Info** | Opens browser decision UI (`/act/card/…`) |
| **Yes / No** | One-shot → peer to `--target` |

Full table + rules: `.sm/AGENTS.md`.

## Common cmds (still via `agent`)

| Job | Command |
|-----|---------|
| Operator eyes (beta) | `agent notify "<session>" "<check>" [--url <link>]` |
| Rich details / images | `agent notify details\|md "<title>" --md <file> [--image <path>]` |
| Yes/No decision (beta) | `agent notify yesno "<title>" "<body>"` |
| Reply / ask | `agent peer <target> "<msg>" [--ended <ack-id>]` |
| Close ask | `agent ack <id> "<note>"` |
| List / stop checkback | `agent cb list` · `agent cb cancel <id>` |
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

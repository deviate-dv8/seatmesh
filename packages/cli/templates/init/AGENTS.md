# Seatmesh CLI (default for every agent)

**Engine-owned.** Do not invent alternate CLIs. Discover with `agent`, then run only what it lists.

## Every turn

```bash
seatmesh agent whoami
seatmesh agent          # can / cannot for THIS pane
seatmesh agent help     # short index + card
seatmesh agent help peer  # usage for one verb (also: peer --help)
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
Full recipe every time: `seatmesh agent help notify`.

### Three shapes (pick one)

```bash
# 1) Eyes only (existing URL)
seatmesh agent notify "Deploy check" "Open staging" --url "http://127.0.0.1:5080"

# 2) Info only — markdown card, no Yes/No
seatmesh agent notify info "Landing CTA" --body "## Options

- A terracotta
- B black"
# or: --md ./brief.md [--image shot.png]

# 3) Info + Yes + No on one card (decision)
seatmesh agent notify yesno "Ship terracotta?" "Need your call" \
  --body "## Why

Ship A — matches brand." \
  --image ./shot.png \
  --target manager \
  --yes-msg "Ship A" \
  --no-msg "Hold"
```

| Shape | Command | Operator gets |
|-------|---------|---------------|
| Eyes | `notify "<session>" "<check>" [--url]` | Toast (+ link) |
| Info | `notify info\|md "<title>" --md\|--body …` | Toast + `/act/card` markdown |
| Decide | `notify yesno "<title>" "<blurb>" --md\|--body …` | Toast **Info · Yes · No**; Yes/No peer to `--target` |

**yesno:** `<title>` = decision name · `<blurb>` = short toast line · Info content via `--md` / `--body` (not the blurb alone).

Aliases: `notify info` · `notify md` · `notify details`

## Common cmds (still via `agent`)

| Job | Command |
|-----|---------|
| Craft Info link | `agent notify info\|md "<title>" --md <file>\|--body "…"` |
| Info + Yes/No | `agent notify yesno "<title>" "<blurb>" --body "…" [--target seat]` |
| Eyes + URL | `agent notify "<session>" "<check>" [--url <link>]` |
| Notify recipe | `agent help notify` |
| Reply / ask | `ask <t> "…"` · `msg <t> "…"` · `peer <t> "…"` · `ackmsg <t> "…"` (close) · `reply <id>` |
| Close ask | `agent ack <id> "<note>"` · `reply <id>` |
| Give a seat a todo | `agent todo give <target> "…"` · `todo <target> "…"` · `assign` |
| List / stop checkback | `agent cb list` · `agent cb cancel <id>` |
| CC-LIMIT banner → idle (leads) | `agent limit idle` · `agent limit idle-clear` (CBs still fire) |
| Role-pack (operator) | `roles status` · `roles migrate` · `update` (refresh locked `_vendor`) |
| Room | `agent room tail [-r slug]` · `agent room say …` |
| Peek | `agent peek <target> status\|full` |
| Agent vs terminal | `agent kind <target>` (aliases: `what`, `typeof`) |
| Seats snapshot | `agent contexts` |
| Give a seat a todo | `agent todo give <target> "…"` · `todo <target> "…"` · `assign` |
| Append / check a TASK | `agent todo add\|check` · `agent seat task …` (check → `todos.reportTo`) |
| Who is slacking? | `agent ppa` · `agent ppa --raw` |
| Retrieval hub | `agent hub` · `agent hub todos\|acks\|cbs\|chat\|room\|shared\|contexts` (alias `get`) |
| Chat history | `agent chat tail` · `agent hub chat` · `agent read-history` (alias `history`) |
| Command help | `agent help [cmd]` · `help <cmd>` · `<cmd> --help` |
| Greppable cmd docs | `docs/COMMANDS.md` · `docs/cli/<verb>.md` |
| Other meshes | `agent remote` · `agent remote <alias> <seat> "…"` · `peer @alias:seat` |

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

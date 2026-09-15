# Command reference

Use **one** command per need. Producers enqueue; the inbox daemon injects. Do not
raw-paste into tmux from scripts when a command exists.

## Session

| Need | Command |
|------|---------|
| Attach / create session | `session attach` or bare entry (consumer wrapper) |
| Session status | `session status` |
| Rebuild + refresh labels | `reload` |
| Re-grid workers/minis | `layout` (`--dry-run` then `--yes` if shrink would kill live panes) |
| Label health | `verify` |
| Persist CLI map | `save` or `auto` (summary + labels; `--json` / `--no-labels`) |

## Identity and seats

| Need | Command |
|------|---------|
| What can I run (scoped) | `agent` / `agent <cmd>` |
| Who am I / hub inline | `whoami [target]` |
| Validate role-index paths | `whoami --validate` |
| Retrieve contexts/todos/acks/cbs/chat/room/shared | `hub` · `hub <entity>` (alias `get`) |
| Usage for one command | `help <cmd>` · `agent help <cmd>` · `<cmd> --help` |
| Put agent on a pane (human) | `help human` · `switch <target> <cli>` |
| Shell tab completion | `completion install` · `eval "$(seatmesh completion zsh)"` |
| Greppable command catalog | `docs/COMMANDS.md` · `docs/cli/<verb>.md` (`rg "^## peer$" docs/COMMANDS.md`) |
| Other live meshes | `remote` · `remote <alias> <seat> "…"` · `sessions` · `peer @alias:seat` |
| Role briefing inject | fresh launch/switch/restart injects FRESH SUMMON — agent runs `seatmesh --profile .sm agent whoami` |
| Ensure seat templates | `seat init` (also runs on reload / session up) |
| Give a seat work | `assign <target> <text>` — FOCUS NOW + TASK + peer SENT. Do not hand-edit FOCUS. |
| Flip seat Mark | `seat mark <target> <OPEN\|BUSY\|BLOCKED>` |
| Write FOCUS NOW only | `seat now <target> <text>` (no peer) |
| Reply / ask | `ask <t> "…"` · `msg <t> "…"` · `peer` · `ackmsg <t> "…"` · `reply <id>` |
| Give a seat a todo | `todo give <target> "…"` · `todo <target> "…"` |
| Append / check a TASK | `todo add\|check <target> "…"` (file-only add; check → `todos.reportTo`) |
| Append a reminder | `seat remind <target> "<text>"` |
| Seat map | `contexts [--json]` |
| Who is slacking? | `ppa` (idle∧open work; `--raw` = telemetry) |
| Cold archive | `snapshot here <slug>` |

## Comms

**patterns.md:** one command per goal — no flag forest. See `doc-inputs/patterns.md`
"Single Command, Zero Decisions".

**CLI vs agent methods:** living forum + triage table
`tasks/seat-mesh/forums/cli-usage-forum.md` (grep-first; do not ingest whole file each turn).
Use `seatmesh --profile .sm agent` for scoped **can/cannot**; use forum **COLLAPSE/METHOD** rows when proposing new surface.

| Goal | Command |
|------|---------|
| Manager → any pane (tell now) | `peer <target> <msg>` |
| Worker → worker | `to-slot <N> <msg>` |
| Worker → mini | `to-mini <N> <msg>` |
| Worker → manager | `to-master <msg>` |
| Shared digest (managers / global) | `room say [-r managers] <msg>` |
| Read room | `room tail [-r managers] [-n N]` |
| Fan-out all agents | `room broadcast <msg>` |
| Remind seats | `remind <slot\|all> [note]` |
| Poll later | `checkback start 5m --renew 3m --expect "…" --here` |
| Reset / ack intercept | `checkback reset <id> 5m` · `checkback ack <id> yes\|no` |
| Operator toast (plain) | `notify <session> <check> [--url URL]` |
| Rich notify (mdview) | `notify info\|md "<title>" --md <file>\|--body "…" [--image <path>]` |
| Yes / No decide | `notify yesno "<title>" "<blurb>" [--md file] [--target seat]` |
| Dan Yes/No → agent | `notify yesno <title> <body> [--target secretary]` |

**Multi-manager coordination:** `room say -r managers "SYNC: …"` (shared ledger).
Use `peer manager` or `peer slot-N` when you need immediate inject to one pane.

**Legacy:** `prompt [--manager] <target> …` = same queue as `peer` when `-m`.

Targets for `peer`: `manager`, `secretary`, `slot-N`, `mini-N`, pane id.

## Agents and panes

| Need | Command |
|------|---------|
| **Empty shell → agent CLI** | `switch <target> <opencode\|claude\|agent\|kiro>` — see `help human` |
| Agent → plain shell | `switch <target> empty` |
| Launch / restart configured CLI | `launch [all\|manager\|secretary\|1-6\|mini-N\|…]` |
| Give seat **work** (not a CLI) | `assign <target> "<text>"` |
| Swap two workers/minis (screen) | `swap <a> <b>` (manager/secretary) |
| Swap numbers + seat dirs | `swap <a> <b> --identity` |
| Rescue stuck composer | `flush <target>` |
| Pane status / scrollback | `peek <target> status\|full` |
| Agent vs terminal? | `kind <target>` (aliases: `what`, `typeof`) |
| Who is slacking? | `ppa` · `ppa --raw` |
| Pane op queue | `ops list\|clear` |

## Minis and secretary

| Need | Command |
|------|---------|
| Mini spawn / done | `mini spawn\|prompt\|done\|list\|dispatch-all` |
| Secretary | `secretary start\|dispatch\|collect\|status\|watch on\|off` |

## Engine

| Need | Command |
|------|---------|
| Inbox health | `inbox [--json]` (consumer **:31670** — see [PORTS.md](PORTS.md)) |
| Inbox queue | `inbox list` \| `inbox all` \| `inbox resolve <id-prefix\|all>` |
| Inbox lifecycle | `inbox stop\|restart` |
| Night / continue | `night on\|off\|status` then `continue <slot\|all>` (manager pane only) |
| Slot advice | `slot-advice <slot\|slot-N> [--send] [note...]` (manager; worktree DB/Redis heuristics) |
| Inbox forensics | `inbox [--wait N] [--meta]` · `inbox log [N]` · `inbox instances` |
| Tag resume | `tag <target\|self> <resume_id\|--auto>` (writes mesh-agents.json) |
| Canonical port | `profile show` → `daemon_port=` |
| Proxy / connectivity | `proxy status\|check\|reset\|rotate` |
| Provider scan | `providers list\|scan` |
| Smoke | `test` |
| Stack passthrough | `stack …` (profile `stack.command`) |
| Profile paths | `profile show` |
| Role index | `index show\|validate` |

## Inject path (implementation)

```text
producer → append JSONL (INBOX | PEER | CHECKBACK | PANE_OPS)
         → inbox daemon (profile daemon.port)
         → orchestratorDrainTick()
         → deliverToPane() → provider.injectPlan() → injectToPane()
```

Runtime queue files live under `{data.root}/daemon/` (see [CONFIG.md](CONFIG.md)).

## Deep dives

| Doc | When |
|-----|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layout, providers, limits |
| [COMMS.md](COMMS.md) | Hop-by-hop comms detail |
| [CHATROOM.md](CHATROOM.md) | Room ledger semantics |
| [CONFIG.md](CONFIG.md) | Profile keys |

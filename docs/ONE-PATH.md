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
| Persist CLI map | `save` or `auto` |

## Identity and seats

| Need | Command |
|------|---------|
| What can I run (scoped) | `agent [target]` |
| Who am I / hub inline | `whoami [target]` |
| Role briefing inject | automatic on attach when configured; `cold-start [target] --inject` |
| Ensure seat templates | `seat init` (also runs on reload / session up) |
| Seat map | `contexts [--json]` |
| Cold archive | `snapshot here <slug>` |

## Comms

**patterns.md:** one command per goal — no flag forest. See `doc-inputs/patterns.md`
"Single Command, Zero Decisions".

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

**Multi-manager coordination:** `room say -r managers "SYNC: …"` (shared ledger).
Use `peer manager` or `peer slot-N` when you need immediate inject to one pane.

**Legacy:** `prompt [--manager] <target> …` = same queue as `peer` when `-m`.

Targets for `peer`: `manager`, `secretary`, `slot-N`, `mini-N`, pane id.

## Agents and panes

| Need | Command |
|------|---------|
| Launch / restart CLIs | `launch [all\|manager\|secretary\|1-6\|mini-N\|…]` |
| Switch CLI type | `switch <target> <agent\|claude\|kiro\|opencode\|empty>` |
| Rescue stuck composer | `flush <target>` |
| Pane status / scrollback | `peek <target> status\|full` |
| Performance index | `ppa [perf-index]` |
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

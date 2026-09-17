---
name: seatmesh-agent
description: >-
  Seatmesh mesh CLI gateway for agent panes. Use when working in a seatmesh
  workspace, handling mesh-inbox/DIGEST mail, peers, todos, checkbacks, ACKs,
  rooms, remotes (@alias:seat), or any seatmesh agent command. Enforces
  whoami → can/cannot, enqueue-only, and no-reconfirm mesh standing.
---

# seatmesh-agent

Engine-owned CLI. Do not invent alternate mesh CLIs.

## Every turn (required)

```bash
seatmesh agent whoami
seatmesh agent          # can / cannot for THIS pane
```

Default config is workspace `.sm/` (walk-up). No `--profile` unless multi-config.

Run work only through:

```bash
seatmesh agent <cmd> …
```

Unknown / not on **can** → `UNAUTHORIZED` (exit 2). Re-run `agent` and pick from the card.

## Hard rules

- Enqueue only — never raw `tmux send-keys` for mesh mail.
- `[mesh-inbox]` / DIGEST = daemon steering, not a new human task.
- FYI / DONE / PROG / PROVED → observe-only; do not peer-reply next steps unless a real ask (`BLOCKED?`) or operator asked.
- Chat prose does **not** clear ACK or cancel checkback — use `ack` / `cb cancel <id>`.
- Inject copy = `mesh-copy.ts` consts. Never paste `patterns.md` into a pane.
- No operator personal name in product/roles/FOCUS.
- NO CONFIRM — act; chat is a status line after action.

## Common cmds

| Job | Command |
|-----|---------|
| Reply / ask | `agent peer\|ask\|msg\|ackmsg <t> "…"` · `agent reply <id>` |
| Close ask | `agent ack <id> "<note>"` |
| Give work | `agent todo give <t> "…"` · `todo <t> "…"` |
| Check task | `agent todo check <t> "…"` · `seat task check` |
| Stop poll | `agent cb list` · `agent cb cancel <id>` |
| Peek | `agent peek <t> status\|full` |
| Kind | `agent kind <t>` |
| Room | `agent room tail\|say …` |
| Remote | `agent remote` · `peer @alias:seat "…"` |
| Hub | `agent hub [todos\|acks\|cbs\|chat\|…]` |

Lead-only verbs (spawn/assign/inbox restart) appear only if listed on **can**.

## Outside `agent` (humans / session ops)

`session` · `save` · `inbox restart` · `update` · `init` · `layout` · `target` — not the pane default path.

## Dig deeper

- Notify / operator eyes → skill `seatmesh-notify`
- Full card / recipes → `seatmesh agent help` · `seatmesh agent help <cmd>`
- Canonical pane brief → `.sm/AGENTS.md`
- Greppable docs → `docs/COMMANDS.md` · `docs/cli/<verb>.md`

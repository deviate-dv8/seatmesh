# Comms

**Command picker:** [ONE-PATH.md](ONE-PATH.md). This file describes hops only.

**Rule:** producers enqueue; the inbox daemon injects. Same as
[ARCHITECTURE.md](ARCHITECTURE.md).

## Flow: room say → checkback → inject

### Hop 1: `room say` (implemented)

Appends to the room ledger, optionally fan-outs to peer panes, optionally arms
checkback on the sender.

```bash
seatmesh room say "DONE: slice complete" [-r global] [--kind claim] [--no-checkback]
```

1. `sayInRoom()` appends to `{chatRooms.root}/<slug>/ROOM.jsonl`.
2. Unless `--no-checkback`, POST checkback to daemon (`daemon.port`).
3. Fan-out uses PEER queue when enabled.

| Module | Role |
|--------|------|
| `packages/core/src/chatroom/room.ts` | Ledger + checkback arm |
| `packages/core/src/chatroom/inbox-client.ts` | HTTP client |
| `packages/cli/src/room-cli.ts` | CLI surface |

### Hop 2: checkback

Daemon stores rows in `{data.root}/daemon/CHECKBACK.jsonl`. On expiry, injects
`Check: <expect>` to the owner pane when composer allows.

Renewal uses profile `chatRooms.checkback.duration` / `renew`.

### Hop 3: daemon inject

`deliverToPane()` in `packages/daemon/src/inject-delivery.ts`:

`registry.detect` → `provider.injectPlan()` → `injectToPane()`.

Holds when composer is `typing` / `busy` / `limit`; delivers on `empty` / `afk`.

## Inbox and peer

| Command | Queue | Target |
|---------|-------|--------|
| `to-master` | INBOX | manager |
| `to-slot` | PEER | worker pane |
| `to-mini` | PEER | mini pane |
| `prompt` / `remind` | PEER | worker (manager prefix) |

Delivery proof: rows should not mark sent without verified inject (`jsonl-store`
`isInboxDelivered`).

## Single drain

```text
orchestratorDrainTick()
  ├── inbox rows
  ├── peer rows
  ├── checkback expiry
  ├── pane ops (serial)
  └── border paint
```

Wake: poll loop (`daemon.pollMs`); optional BullMQ nudge when Redis is up.

## Notify-act (Yes / No links → browser → mesh)

Plasma action buttons often fail; use **HTML links** in the toast body instead.

| Step | What |
|------|------|
| Register | `POST http://127.0.0.1:<port>/act/register` |
| Click | `GET /act/v1/<token>` (one-shot) |
| FE test | `GET /ui` · `GET /ui/demo-yesno` (button-styled Yes/No) |

CLI/library: `sendYesNoToast(loaded, title, body, yesMsg, yesTarget?)` or
`yesNoNotifyActActions()` + `sendDesktopToastWithActLinks()`.

## Deep reference

| Topic | Doc |
|-------|-----|
| Room semantics | [CHATROOM.md](CHATROOM.md) |
| Config keys | [CONFIG.md](CONFIG.md) |
| Provider inject | [ARCHITECTURE.md](ARCHITECTURE.md) |

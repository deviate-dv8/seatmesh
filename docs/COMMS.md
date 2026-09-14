# Comms

**Command picker:** [ONE-PATH.md](ONE-PATH.md). This file describes hops only.

**Rule:** producers enqueue; the inbox daemon injects. Same as
[ARCHITECTURE.md](ARCHITECTURE.md).

**Bypass (inbox down):** when `/health` is unavailable, `peer`, `to-slot`,
`to-mini`, `prompt`, and room fan-out fall back to direct pane inject. Every
bypass send logs `WARN: bypass comms -> … NOT saved to peer history` on stderr
(no `PEER.jsonl` row). Remote peer (`@alias:seat`) still requires the foreign
inbox.

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

### Cross-tier worker ↔ mini (2026-09-14)

Direct peer only — no room call / contract / supervise / balance.

| Direction | Command |
|-----------|---------|
| Worker → mini | `peer mini-N` or `to-mini N <msg>` |
| Mini → worker | `peer slot-N <msg>` |

### Cross-session peer (same host)

Configure foreign meshes in profile yaml:

```yaml
remotes:
  zsign:
    profile: /path/to/zsign/.sm
```

Then from any pane: `peer @zsign:manager <msg>` — enqueues on the foreign inbox (`portScope: workspace`).

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

## Notify-act (Yes / No in toast → browser → mesh)

**Canonical operator reply path.** Plasma `-A` action buttons are unreliable on Linux/KDE;
use **HTML `<a href>` links** in the toast body instead. No duplicate plain `Yes: http://…`
lines — only the anchor row (`Yes · No`).

| Step | What |
|------|------|
| Register | `POST http://127.0.0.1:<port>/act/register` (TTL default 3600s) |
| Click | `GET /act/v1/<token>` → HTML result page; token is one-shot |
| Side effect | Usually `peer` → enqueue inject to a seat (default **`secretary`**) |
| Browser UI | `GET /ui` · `GET /ui/demo-yesno` (same URLs as toast; button styling) |

**Delivery:** `@seat-mesh/tmux` `sendDesktopToastSync` / `node-notifier` only for library
toasts (no workspace `notify.sh`). Inbox/CPE recovery toasts stay plain text via
`runInboxDesktopNotifySync`.

**CLI (from repo with profile):**

```bash
seatmesh notify yesno "<title>" "<body>"
seatmesh notify yesno "Approve the mesh change?" "Details…" --target manager
# agent pane: reply seat defaults to whoami (slot-N / manager / …)
seatmesh agent notify yesno "Ship CTA?" "Preview http://localhost:5080/"
```

**Library:** `sendYesNoToast(loaded, title, body, { target?, yesMsg?, noMsg? })` —
default target = whoami seat, else `manager`. Clicks peer `[operator-decide] YES|NO — title`.
Opens Info card (`/act/card/…`) in the browser. Toast body uses plain URLs (notify-send safe).

**Action types** (`packages/core/src/chatroom/notify-act.ts`): `peer`, `inbox-resolve`,
`checkback-ack`, `ping`. Registry + execute: `packages/daemon/src/notify-act.ts` on the
inbox HTTP server (`mesh-inbox-server.ts`).

Restart after daemon package changes: `seatmesh --profile .sm inbox restart`.

## Deep reference

| Topic | Doc |
|-------|-----|
| Room semantics | [CHATROOM.md](CHATROOM.md) |
| Config keys | [CONFIG.md](CONFIG.md) |
| Provider inject | [ARCHITECTURE.md](ARCHITECTURE.md) |

# ChatRoom

Durable parallel comms: every contract member reads the same ledger without ACK
loops through manager/secretary.

Inbox still drains to manager/secretary for coordination. ChatRoom is separate.

## Global room (default)

Every tmux agent is in the **global** room by default — no join step.

| Room | Slug | Who |
|------|------|-----|
| Global | `chatRooms.globalSlug` (default `global`) | All workers, minis, manager, secretary |
| Named | any other slug | Parallel slice / contract |

Manager and secretary may `room say` and `room broadcast` to global without
membership checks. Broadcast uses `kind: broadcast` and a `BROADCAST:` body prefix.

Workers and minis: `room say` without `--room` → global. `room tail` at turn
start reads the same ledger.

```bash
seat-mesh room say "FYI: starting auth slice"
seat-mesh room tail

seat-mesh room broadcast "Pause until integration check passes"

seat-mesh room say --room my-contract "CLAIMED: module X"
```

## Inbox vs room

| Use | Mechanism |
|-----|-----------|
| Manager coordination, DONE/PROVED/BLOCKED | `to-master` → INBOX |
| Peer clarify | `to-slot` / `to-mini` → PEER |
| Parallel visibility, claims, FYI | `room say` → ledger (+ optional fan-out) |
| High-signal all-hands | `room broadcast` |

Do not duplicate the same substance in inbox and room every turn.

## Ledger layout

```text
{chatRooms.root}/
  global/
    ROOM.jsonl
  <slug>/
    ROOM.jsonl
    meta.json
```

Append-only. `room tail` reads recent lines; contracts may add `CONTRACT.md`
beside the slug (consumer convention).

## Checkback on say

Default: `room say` arms checkback on the sender (`chatRooms.checkback` durations)
so the pane does not chat-block waiting for peers. Pass `--no-checkback` for
fire-and-forget.

## Calls (optional)

Room call flow uses shorter pending durations (`callPending` in profile). See
`packages/core/src/chatroom/calls.ts`.

## CLI summary

```bash
room list
room create <slug> [--members …]
room say [--room slug] [--kind …] [--no-checkback] <text>
room broadcast <text>
room tail [--room slug] [-n lines]
```

Config: [CONFIG.md](CONFIG.md) `chatRooms` section.

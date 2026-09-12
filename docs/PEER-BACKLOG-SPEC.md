# Peer + inbox backlogging (seatmesh)

**Status:** spec (operator 2026-09-12). Agents keep working the active hub; comms do not hijack priority.

## Goal

When a seat is **BUSY on a hub**, new coordination mail must **not override** the task in flight. Mail is either **delivered lightly** (ACK/status) or **backlogged** until the seat is idle — never steal composer priority.

## Priority stack (every agent)

Read `tasks/agent-seats/slot-N/PRIORITY.md` (or handout hub doc). Order is always:

| Rank | What | Rule |
|------|------|------|
| **1** | **Active HUB** in FOCUS / `@mesh_title` | Finish or `BLOCKED:` before switching. Mark `BUSY`. |
| **2** | **Explicit override** | Manager line with `PRIORITY` or `STOP other work` — only then pivot. |
| **3** | **Backlog queue** | Parked prompts/reminds/room when rank-1 was busy. FIFO per pane on idle. |
| **4** | **FYI / room chatter** | Never preempt rank-1. |

Outbound **`./sm.sh to-master ACK|DONE|BLOCKED|PROVED`** is always allowed — that is how the seat reports, not a new task.

## Two lanes (do not conflate)

| Lane | Transport | Busy-seat behavior |
|------|-----------|-------------------|
| **Outbound status** | Worker `./sm.sh to-master …` | Always allowed. Does not change rank-1. |
| **Inbound coordination** | `PEER.jsonl` (prompt/remind/to-slot/room) or manager `INBOX.jsonl` | See below |

Agents **can still receive** inbound ACK/status class mail. Receiving ≠ new priority. **Shell ACK only** (`./sm.sh to-master ACK: …`); do not abandon the hub in chat.

## Inbound: deliver vs backlog

### Always deliver (even when BUSY on hub)

Lightweight — agent may read and **ACK in shell**, must **not** pivot hub:

- Body matches `^(ACK|FYI|STAND-?BY|MCP-?SYNCED|CHECKBACK\?)\b`
- Secretary/manager **compose-gate** already holds heavy substance on coord panes; workers use peer backlog instead

### Backlog (when seat BUSY)

Park to `PEER-BACKLOG.jsonl`; promote when pane **idle** (`composer empty/afk` and `@mesh_status` not `BUSY`):

- `prompt` / `remind` without `PRIORITY` / `STOP other work`
- New HUB assignment while another HUB is open in FOCUS
- `room` fan-out (non-urgent)
- Any inject that would `held:busy` / `held:typing`

### Deliver when idle

Normal FIFO from backlog + live queue (prompt before room).

## Agent POV (required)

1. **Hub first.** Border `BUSY` + FOCUS hub = rank-1 until DONE/BLOCKED.
2. **ACK mail is not a new task.** If a line appears while generating: run `./sm.sh to-master ACK: …` if asked, then **continue the hub**.
3. **Do not** read backlog prompts until hub DONE and composer idle (daemon promotes then).
4. **Done signal:** `./sm.sh to-master DONE: <HUB> <evidence>` then Mark OPEN or next hub.

## Daemon (seatmesh)

- `peer-backlog.ts`: on `held:busy|held:typing`, park row → `PEER-BACKLOG.jsonl`, **continue draining other panes** (no global wedge).
- `promotePeerBacklog`: when target pane idle, re-queue oldest backlog row to `PEER.jsonl`.
- `shouldBacklogPeerHold`: false for ACK-class body (deliver lightly even if busy — prefer steer only on cursor follow-up lane).
- Manager/secretary: existing `compose-gate.ts` (substance held, ACK lane to secretary).

## Verify

```bash
# Seat busy on hub
./sm.sh status slot-4 BUSY
./sm.sh prompt slot-4 "low priority ping"   # -> backlog, not inject
./sm.sh prompt --manager slot-4 "ACK: ping"  # -> deliver (if ACK-class)

# After DONE + idle
./sm.sh status slot-4 OPEN
# backlog promotes on next drain tick
```

## Anti-patterns

- Injecting a full new HUB prompt into a **Running** Claude/OpenCode pane as rank-1 replacement.
- Treating `[INBOX]` or manager prefix as "drop current hub."
- Backlogging worker **outbound** ACK (impossible — append-only to INBOX).
- Global peer queue wedge (one busy pane blocking all panes).

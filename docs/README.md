# seatmesh documentation

Job-grouped guide — not an API dump. One path per need.

Hosted gallery: [`.sm/mds` INDEX](../.sm/mds/INDEX.md) · hub `/mds`

Paths are **profile-driven** (`mesh.config.yaml` / `.sm/mesh.config.yaml`).

---

## Start here

| Need | Doc |
|------|-----|
| Init / attach / cold start | [QUICKSTART](QUICKSTART.md) |
| One command per job | [ONE-PATH](ONE-PATH.md) |
| Golf / SM function rules | [SMFUNCTIONS-SPEC](SMFUNCTIONS-SPEC.md) |
| What the engine provides | [FEATURES](FEATURES.md) |
| Put a CLI on a pane | [cli/human](cli/human.md) |
| Layout / columns | [cli/layout](cli/layout.md) |
| Contracts | [cli/contract](cli/contract.md) |
| Config / kinds | [CONFIG](CONFIG.md) |

---

## Agent path (`sm agent …`)

Pane gateway. Prefer **one** verb per job. Full map: [cli/README](cli/README.md).

| Need | Prefer | Doc |
|------|--------|-----|
| Who / can | `whoami` · bare `agent` | [cli/whoami](cli/whoami.md) · [cli/agent](cli/agent.md) |
| Give work | `todo give` | [cli/todo](cli/todo.md) |
| Tell a seat | **`peer`** | [cli/peer](cli/peer.md) |
| Close ask | `ack` | [cli/ack](cli/ack.md) |
| Poll later | `cb` | [cli/cb](cli/cb.md) |
| Shared ledger | `room` | [cli/room](cli/room.md) |
| Operator eyes | `notify` | [cli/notify](cli/notify.md) |
| Prompt log | `chat` · `hub chat` | [cli/chat](cli/chat.md) |

Background: [COMMS](COMMS.md) · [CHATFILE](CHATFILE.md) · [CHATROOM](CHATROOM.md)

---

## Operator path (outside `agent`)

Humans / session ops — not the pane default.

| Need | Prefer | Doc |
|------|--------|-----|
| Session | `session` · `reload` · `verify` | [cli/session](cli/session.md) |
| Grid | `layout` | [cli/layout](cli/layout.md) |
| Put CLI on pane | `switch` · `launch` | [cli/switch](cli/switch.md) · [cli/launch](cli/launch.md) |
| Persist map | `save` | [cli/save](cli/save.md) |
| Inbox daemon | `inbox` | [cli/inbox](cli/inbox.md) |
| Hub UI | `web` | [cli/web](cli/web.md) |
| Update / init | `update` · `init` | [cli/update](cli/update.md) · [cli/init](cli/init.md) |

Deep: [ARCHITECTURE](ARCHITECTURE.md) · [DOTDIR](DOTDIR.md) · [STATE](STATE.md)

---

## Concepts

| Topic | Doc |
|-------|-----|
| Profiles | [PROFILES](PROFILES.md) |
| Roles | [ROLE-YAML](ROLE-YAML.md) · [SLOTS](SLOTS.md) |
| Ports | [PORTS](PORTS.md) |
| Storage | [STORAGE](STORAGE.md) |
| Portability | [PORTABILITY](PORTABILITY.md) |
| Peer backlog | [PEER-BACKLOG-SPEC](PEER-BACKLOG-SPEC.md) |
| Supervise / manager-2 | [SUPERVISOR-MANAGER2](SUPERVISOR-MANAGER2.md) |
| Proxy toasts | [PROXY-NOTIFICATIONS](PROXY-NOTIFICATIONS.md) |
| Patterns | [patterns/](patterns/README.md) |
| Releases | [RELEASE](RELEASE.md) |

---

## Collapse / legacy (golf)

Prefer the left. Do not teach aliases as first choice.

| Prefer | Instead of |
|--------|------------|
| `peer` | `ask` · `msg` · `tell` · `prompt` · `to-slot` · `to-mini` |
| `peer --ack` | `ackmsg` |
| `todo give` | `assign` |
| `cb` | `checkback` · `patience` |
| `hub chat` | `read-history` |
| `room` / chat | `to-master` (DEPRECATED) |

---

## Grep / full catalog

When you already know the verb name:

```bash
rg "^## peer$" docs/COMMANDS.md
seatmesh help peer
```

- Job-grouped CLI stubs: [cli/README](cli/README.md)
- A–Z dump (last resort): [COMMANDS](COMMANDS.md)

---

## Shipped profiles

| Profile | Purpose |
|---------|---------|
| `profiles/minimal/` | Smallest demo |
| `profiles/consumer/` | Full consumer layout |

## Internal / planning

Not day-to-day: [../TODO.md](../TODO.md) · [../NOW.md](../NOW.md) · [PARALLEL](PARALLEL.md) · [SURPASS](SURPASS.md) · [SM-JSON-ENGINE-DRAFT](SM-JSON-ENGINE-DRAFT.md)

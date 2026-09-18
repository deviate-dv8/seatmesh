# seatmesh CLI — by job

Not an A–Z API list. One command per need. Grep stubs when you know the name.

```bash
seatmesh help <verb>
rg "^## peer$" docs/COMMANDS.md
```

Full dump (last resort): [../COMMANDS.md](../COMMANDS.md)

---

## Agent (`sm agent …`)

### Identity & map

| Verb | File |
|------|------|
| `agent` | [agent.md](agent.md) |
| `whoami` | [whoami.md](whoami.md) |
| `contexts` | [contexts.md](contexts.md) |
| `hub` | [hub.md](hub.md) |
| `kind` | [kind.md](kind.md) |
| `peek` | [peek.md](peek.md) |
| `ppa` | [ppa.md](ppa.md) |

### Work

| Verb | File |
|------|------|
| `todo` | [todo.md](todo.md) |
| `seat` | [seat.md](seat.md) |
| `assign` | [assign.md](assign.md) — prefer `todo give` |

### Comms (inject)

| Verb | File |
|------|------|
| `peer` | [peer.md](peer.md) — prefer this |
| `ack` | [ack.md](ack.md) |
| `cb` | [cb.md](cb.md) |
| `room` | [room.md](room.md) |
| `notify` | [notify.md](notify.md) |
| `remote` | [remote.md](remote.md) |
| `sessions` | [sessions.md](sessions.md) |
| `reply` | [reply.md](reply.md) |

### Read (not inject)

| Verb | File |
|------|------|
| `chat` | [chat.md](chat.md) |
| `mds` | [mds.md](mds.md) |
| `preview` | [preview.md](preview.md) |
| `read-history` | [read-history.md](read-history.md) — prefer `hub chat` |

### Shorthands → collapse to `peer` / `todo`

| Verb | Prefer |
|------|--------|
| [ask](ask.md) · [msg](msg.md) · [tell](tell.md) | `peer` |
| [ackmsg](ackmsg.md) | `peer --ack` |
| [prompt](prompt.md) | `peer` |
| [to-slot](to-slot.md) · [to-mini](to-mini.md) | `peer slot-N` / `peer mini-N` |
| [to-master](to-master.md) | DEPRECATED — `room` / chat |

---

## Operator (outside `agent`)

| Verb | File |
|------|------|
| `human` | [human.md](human.md) — cheat sheet |
| `session` | [session.md](session.md) |
| `layout` | [layout.md](layout.md) |
| `spawn` | [spawn.md](spawn.md) — empty→CLI |
| `switch` | [switch.md](switch.md) — replace live |
| `launch` | [launch.md](launch.md) |
| `pane` | [pane.md](pane.md) |
| `save` · `auto` | [save.md](save.md) · [auto.md](auto.md) |
| `reload` · `rebuild` · `verify` · `realign` | [reload.md](reload.md) · [rebuild.md](rebuild.md) · [verify.md](verify.md) · [realign.md](realign.md) |
| `inbox` | [inbox.md](inbox.md) |
| `web` | [web.md](web.md) |
| `contract` | [contract.md](contract.md) |
| `balance` | [balance.md](balance.md) |
| `init` · `update` | [init.md](init.md) · [update.md](update.md) |
| `config` · `providers` | [config.md](config.md) · [providers.md](providers.md) |
| `target` | [target.md](target.md) |

### Occasional / niche

| Verb | File |
|------|------|
| `mini` · `secretary` | [mini.md](mini.md) · [secretary.md](secretary.md) |
| `base` · `stack` · `labels` | [base.md](base.md) · [stack.md](stack.md) · [labels.md](labels.md) |
| `set` · `tag` · `swap` · `title` | [set.md](set.md) · [tag.md](tag.md) · [swap.md](swap.md) · [title.md](title.md) |
| `ops` · `limit` · `proxy` | [ops.md](ops.md) · [limit.md](limit.md) · [proxy.md](proxy.md) |
| `night` · `continue` · `flush` · `remind` | [night.md](night.md) · [continue.md](continue.md) · [flush.md](flush.md) · [remind.md](remind.md) |
| `slot-advice` | [slot-advice.md](slot-advice.md) |
| `cold-start` · `completion` · `migrate-runtime` | [cold-start.md](cold-start.md) · [completion.md](completion.md) · [migrate-runtime.md](migrate-runtime.md) |
| `func` · `profile` · `roles` · `report` · `status` · `start` · `test` · `version` · `help` · `index` · `pane-meta` | see files |

---

## A–Z (grep only)

When you already know the name — do not browse this as the guide.

<details>
<summary>All stubs</summary>

| Verb | File |
|------|------|
| `ack` | [ack.md](ack.md) |
| `ackmsg` | [ackmsg.md](ackmsg.md) |
| `agent` | [agent.md](agent.md) |
| `ask` | [ask.md](ask.md) |
| `assign` | [assign.md](assign.md) |
| `auto` | [auto.md](auto.md) |
| `balance` | [balance.md](balance.md) |
| `base` | [base.md](base.md) |
| `cb` | [cb.md](cb.md) |
| `chat` | [chat.md](chat.md) |
| `cold-start` | [cold-start.md](cold-start.md) |
| `completion` | [completion.md](completion.md) |
| `config` | [config.md](config.md) |
| `contexts` | [contexts.md](contexts.md) |
| `continue` | [continue.md](continue.md) |
| `contract` | [contract.md](contract.md) |
| `flush` | [flush.md](flush.md) |
| `func` | [func.md](func.md) |
| `help` | [help.md](help.md) |
| `hub` | [hub.md](hub.md) |
| `human` | [human.md](human.md) |
| `inbox` | [inbox.md](inbox.md) |
| `index` | [index.md](index.md) |
| `init` | [init.md](init.md) |
| `kind` | [kind.md](kind.md) |
| `labels` | [labels.md](labels.md) |
| `launch` | [launch.md](launch.md) |
| `layout` | [layout.md](layout.md) |
| `limit` | [limit.md](limit.md) |
| `mds` | [mds.md](mds.md) |
| `migrate-runtime` | [migrate-runtime.md](migrate-runtime.md) |
| `mini` | [mini.md](mini.md) |
| `night` | [night.md](night.md) |
| `notify` | [notify.md](notify.md) |
| `ops` | [ops.md](ops.md) |
| `pane` | [pane.md](pane.md) |
| `pane-meta` | [pane-meta.md](pane-meta.md) |
| `peek` | [peek.md](peek.md) |
| `peer` | [peer.md](peer.md) |
| `ppa` | [ppa.md](ppa.md) |
| `preview` | [preview.md](preview.md) |
| `profile` | [profile.md](profile.md) |
| `prompt` | [prompt.md](prompt.md) |
| `providers` | [providers.md](providers.md) |
| `proxy` | [proxy.md](proxy.md) |
| `read-history` | [read-history.md](read-history.md) |
| `realign` | [realign.md](realign.md) |
| `reload` | [reload.md](reload.md) |
| `remind` | [remind.md](remind.md) |
| `remote` | [remote.md](remote.md) |
| `reply` | [reply.md](reply.md) |
| `report` | [report.md](report.md) |
| `roles` | [roles.md](roles.md) |
| `room` | [room.md](room.md) |
| `save` | [save.md](save.md) |
| `seat` | [seat.md](seat.md) |
| `secretary` | [secretary.md](secretary.md) |
| `session` | [session.md](session.md) |
| `sessions` | [sessions.md](sessions.md) |
| `set` | [set.md](set.md) |
| `slot-advice` | [slot-advice.md](slot-advice.md) |
| `stack` | [stack.md](stack.md) |
| `start` | [start.md](start.md) |
| `status` | [status.md](status.md) |
| `swap` | [swap.md](swap.md) |
| `switch` | [switch.md](switch.md) |
| `tag` | [tag.md](tag.md) |
| `target` | [target.md](target.md) |
| `test` | [test.md](test.md) |
| `title` | [title.md](title.md) |
| `to-master` | [to-master.md](to-master.md) |
| `to-mini` | [to-mini.md](to-mini.md) |
| `to-slot` | [to-slot.md](to-slot.md) |
| `todo` | [todo.md](todo.md) |
| `update` | [update.md](update.md) |
| `verify` | [verify.md](verify.md) |
| `version` | [version.md](version.md) |
| `web` | [web.md](web.md) |
| `whoami` | [whoami.md](whoami.md) |

</details>

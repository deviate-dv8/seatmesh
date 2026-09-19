# seatmesh commands

Greppable usage catalog for every CLI verb. **Source of truth:**
`packages/cli/src/commands/help-text.ts` (also drives `seatmesh help <cmd>`).

```bash
# list all verbs
rg -n "^## " docs/COMMANDS.md

# find one verb
rg -n "^## peer$|^## whoami$" docs/COMMANDS.md

# one file per verb
ls docs/cli | rg peer
rg -n . docs/cli/peer.md

# runtime help (same text)
seatmesh help peer
seatmesh agent help peer
seatmesh peer --help
```

| Job | Doc |
|-----|-----|
| One command per goal | [ONE-PATH.md](ONE-PATH.md) |
| Agent gateway card | `.sm/AGENTS.md` · `seatmesh agent` |
| Per-verb markdown | [cli/](cli/) |

## aliases

- `ackmsg` → [`ackmsg`](#ackmsg) · [cli/ackmsg.md](cli/ackmsg.md)
- `answered` → [`ackmsg`](#ackmsg) · [cli/ackmsg.md](cli/ackmsg.md)
- `ask` → [`ask`](#ask) · [cli/ask.md](cli/ask.md)
- `cc` → [`switch`](#switch) · [cli/switch.md](cli/switch.md)
- `checkback` → [`cb`](#cb) · [cli/cb.md](cli/cb.md)
- `coldstart` → [`cold-start`](#cold-start) · [cli/cold-start.md](cli/cold-start.md)
- `dc` → [`stack`](#stack) · [cli/stack.md](cli/stack.md)
- `empty` → [`kill`](#kill) · [cli/kill.md](cli/kill.md)
- `get` → [`hub`](#hub) · [cli/hub.md](cli/hub.md)
- `handoff` → [`switch`](#switch) · [cli/switch.md](cli/switch.md)
- `history` → [`read-history`](#read-history) · [cli/read-history.md](cli/read-history.md)
- `meshes` → [`remote`](#remote) · [cli/remote.md](cli/remote.md)
- `msg` → [`ask`](#ask) · [cli/ask.md](cli/ask.md)
- `open-web` → [`web`](#web) · [cli/web.md](cli/web.md)
- `operator` → [`human`](#human) · [cli/human.md](cli/human.md)
- `panes` → [`human`](#human) · [cli/human.md](cli/human.md)
- `patience` → [`cb`](#cb) · [cli/cb.md](cli/cb.md)
- `put-agent` → [`human`](#human) · [cli/human.md](cli/human.md)
- `readhistory` → [`read-history`](#read-history) · [cli/read-history.md](cli/read-history.md)
- `rebuild` → [`reload`](#reload) · [cli/reload.md](cli/reload.md)
- `reply` → [`reply`](#reply) · [cli/reply.md](cli/reply.md)
- `seats` → [`contexts`](#contexts) · [cli/contexts.md](cli/contexts.md)
- `targets` → [`target`](#target) · [cli/target.md](cli/target.md)
- `tell` → [`ask`](#ask) · [cli/ask.md](cli/ask.md)
- `todos` → [`todo`](#todo) · [cli/todo.md](cli/todo.md)
- `typeof` → [`kind`](#kind) · [cli/kind.md](cli/kind.md)
- `what` → [`kind`](#kind) · [cli/kind.md](cli/kind.md)
- `where` → [`whoami`](#whoami) · [cli/whoami.md](cli/whoami.md)

## ack

```text
ack | ack list | ack <id> [note] | ack reply <id> [msg] | ack clear
  List/close unanswered asks. Chat prose does NOT clear.
  ack reply = peer back to asker + close (default msg ACK).
  Lead: ack redirect <mini-N>
```

- Run: `seatmesh ack --help`
- Agent: `seatmesh agent help ack`
- File: [cli/ack.md](cli/ack.md)

## ackmsg

```text
ackmsg <target> "<msg>"
  Shorthand: peer --ack <target> "<msg>" (reply + close open ask). All agents.
  Alias: answered
```

- Run: `seatmesh ackmsg --help`
- Agent: `seatmesh agent help ackmsg`
- File: [cli/ackmsg.md](cli/ackmsg.md)

## agent

```text
agent
  Print can/cannot for THIS pane (gateway card).
  agent help [cmd]     usage for one verb
  agent <cmd> …        run if allowed; else UNAUTHORIZED
  agent whoami         full hub dump every turn
```

- Run: `seatmesh agent --help`
- Agent: `seatmesh agent help agent`
- File: [cli/agent.md](cli/agent.md)

## ask

```text
ask <target> "<msg>"
  Shorthand: peer <target> "<msg>" (send / open ask). All agents.
  Also: msg|tell <target> "<msg>"
```

- Run: `seatmesh ask --help`
- Agent: `seatmesh agent help ask`
- File: [cli/ask.md](cli/ask.md)

## assign

```text
assign <target> "<text>"
  Same as: todo give <target> "…"  (FOCUS NOW + TASK + peer inject + CB≥20m).
  Prefer the todo verb. Does NOT put a CLI on the pane — use switch (help human)
```

- Run: `seatmesh assign --help`
- Agent: `seatmesh agent help assign`
- File: [cli/assign.md](cli/assign.md)

## auto

```text
auto [--json] [--no-labels]
  Alias of save (scrape session)
```

- Run: `seatmesh auto --help`
- Agent: `seatmesh agent help auto`
- File: [cli/auto.md](cli/auto.md)

## balance

```text
balance …
  Dual-lead balance (coord)
```

- Run: `seatmesh balance --help`
- Agent: `seatmesh agent help balance`
- File: [cli/balance.md](cli/balance.md)

## base

```text
base ensure|realign
  Base window helpers
```

- Run: `seatmesh base --help`
- Agent: `seatmesh agent help base`
- File: [cli/base.md](cli/base.md)

## cb

```text
cb list | cb start <dur> --expect "…" [--here]
  cb cancel <id> | cb cancel-all | cb reset <id> <dur> | cb ack <id> yes|no
  Poll-later timers (aliases: checkback, patience). Chat does NOT cancel.
```

- Run: `seatmesh cb --help`
- Agent: `seatmesh agent help cb`
- File: [cli/cb.md](cli/cb.md)

## chat

```text
chat tail [--slot key] [--lines N] [--json]
  chat query [--slot|--session|--model|--since|--limit] [--json]
  chat put <slot> "<human>" [--response "<text>"]  (positional upsert, dedupe by turnHash)
  chat get <id> [--slot key] [--json]  (id or turnHash, full or 8-char prefix)
  chat append|record  — per-slot prompt/response CHAT.jsonl
```

- Run: `seatmesh chat --help`
- Agent: `seatmesh agent help chat`
- File: [cli/chat.md](cli/chat.md)

## cold-start

```text
cold-start [target] [--inject] [--force]
  Print (or enqueue) cold-start brief. Alias: coldstart
```

- Run: `seatmesh cold-start --help`
- Agent: `seatmesh agent help cold-start`
- File: [cli/cold-start.md](cli/cold-start.md)

## completion

```text
completion bash|zsh|fish|reply|install
  Shell tab completion. Enable: eval "$(seatmesh completion zsh)"
  Then: sm <TAB>. Prefer global bin: sm install  (legacy: seatmesh).
```

- Run: `seatmesh completion --help`
- Agent: `seatmesh agent help completion`
- File: [cli/completion.md](cli/completion.md)

## config

```text
config check [--json] | config upgrade
  check: validate mesh.config.yaml + paths
  upgrade: how to get latest seatmesh CLI (npm i -g seatmesh@latest) then update
```

- Run: `seatmesh config --help`
- Agent: `seatmesh agent help config`
- File: [cli/config.md](cli/config.md)

## contexts

```text
contexts [--json]
  Seat map (slots/minis/HQ) with open TASK counts + FOCUS preview.
  Alias: seats
```

- Run: `seatmesh contexts --help`
- Agent: `seatmesh agent help contexts`
- File: [cli/contexts.md](cli/contexts.md)

## continue

```text
continue <slot|all> [note...]
  Night continue (manager-only; requires night on)
```

- Run: `seatmesh continue --help`
- Agent: `seatmesh agent help continue`
- File: [cli/continue.md](cli/continue.md)

## contract

```text
contract [status]
  contract show <id>
  contract on|off <id> [--agent <seat>]
  contract create|open <slug>
  Easy locks: status = vendor + ON/off. on/off default agent from yaml
  (supervise→secretary, balance→balance_lead). No --agent needed.
```

- Run: `seatmesh contract --help`
- Agent: `seatmesh agent help contract`
- File: [cli/contract.md](cli/contract.md)

## empty

```text
empty <target|1..4|slot-N|mini-N|here>
  Alias of kill — pane → plain terminal, mesh-agents saved empty
```

- Run: `seatmesh empty --help`
- Agent: `seatmesh agent help empty`
- File: [cli/empty.md](cli/empty.md)

## flush

```text
flush <slot|all|manager|mini-N>
  Rescue stuck composer Enter
```

- Run: `seatmesh flush --help`
- Agent: `seatmesh agent help flush`
- File: [cli/flush.md](cli/flush.md)

## forum

```text
forum | golf
  Print the real shorthand table (Ruby ranges + one verb per job).
  Alias: golf. Also: sm agent forum
```

- Run: `seatmesh forum --help`
- Agent: `seatmesh agent help forum`
- File: [cli/forum.md](cli/forum.md)

## func

```text
func <id> <args...>
  Profile funcs: registry (external.default + role allow)
```

- Run: `seatmesh func --help`
- Agent: `seatmesh agent help func`
- File: [cli/func.md](cli/func.md)

## golf

```text
golf
  Alias for forum — shorthand table (no repo spelunk)
```

- Run: `seatmesh golf --help`
- Agent: `seatmesh agent help golf`
- File: [cli/golf.md](cli/golf.md)

## help

```text
help [cmd]
  Operator default = human surface only (agent verbs hidden).
  Full list: seatmesh --agents help
  One verb:  seatmesh help <cmd> · seatmesh agent help <cmd>
  Put agent: seatmesh help human
```

- Run: `seatmesh help --help`
- Agent: `seatmesh agent help help`
- File: [cli/help.md](cli/help.md)

## host

```text
host up|down|status
  Opt-in single host-supervisor: one process watches all meshes registered in
  ~/.config/seatmesh/sessions.json instead of each spawning its own supervisor.
  Does not affect meshes that haven't opted in (Phase 1, see NOW.md).
```

- Run: `seatmesh host --help`
- Agent: `seatmesh agent help host`
- File: [cli/host.md](cli/host.md)

## hub

```text
hub [contexts|todos|acks|cbs|chat|room|shared|sessions]
  Retrieval + CRUD map; bare hub = guide + live summary for this seat.
  Alias: get
  Examples:
    hub todos | hub acks | hub sessions | hub chat 40 | hub room supervise
```

- Run: `seatmesh hub --help`
- Agent: `seatmesh agent help hub`
- File: [cli/hub.md](cli/hub.md)

## human

```text
human — put an agent CLI on a pane (operator)

  Empty terminal → agent (prefer spawn; **fast by default**):
    spawn <target|1..4> <opencode|opencode-cpe|claude|agent|kiro>
    Examples:
      seatmesh spawn slot-1 opencode
      seatmesh spawn 1..3 opencode-cpe
      seatmesh spawn here agent --slow   # wait verify + FRESH SUMMON

  Replace a live agent:
    switch <target> <cli> [--fast] [reason...]
      seatmesh switch here agent --fast

  Back to plain shell (saves empty in mesh-agents.json):
    kill <target>     # alias: empty
    switch <target> empty --fast

  Start/resume the seat's configured CLI (no type pick):
    launch <target|all|manager|secretary>

  Resume known session on a pane (autodetect ses_* / resume id):
    pane resume [here|secretary|slot-N|…]

  Check agent vs shell:
    kind <target>     # aliases: what | typeof

  Give the seat WORK / a todo (does NOT install a CLI — different from spawn/switch):
    todo give <target> "do the thing"     # preferred
    todo <target> "do the thing"          # shorthand
    assign <target> "do the thing"        # same engine

  Targets: manager | secretary | slot-N | mini-N | here
  Operator help: seatmesh help (human) · seatmesh --agents help (full)
  Aliases for this topic: help put-agent | help panes | help operator
```

- Run: `seatmesh human --help`
- Agent: `seatmesh agent help human`
- File: [cli/human.md](cli/human.md)

## inbox

```text
inbox [--json] [--wait N] [--meta]
  inbox list|resolve|log|instances|stop|restart
  Daemon queue status (restart is lead/operator)
```

- Run: `seatmesh inbox --help`
- Agent: `seatmesh agent help inbox`
- File: [cli/inbox.md](cli/inbox.md)

## index

```text
index show|validate
  Role index paths
```

- Run: `seatmesh index --help`
- Agent: `seatmesh agent help index`
- File: [cli/index.md](cli/index.md)

## init

```text
init [--force] [--seats-root PATH] [--name NAME]
  Create project .sm/ (human). Prefer: start
```

- Run: `seatmesh init --help`
- Agent: `seatmesh agent help init`
- File: [cli/init.md](cli/init.md)

## kill

```text
kill <target|1..4|slot-N|mini-N|here>
  Alias: empty. Respawn pane to plain terminal + save type=empty in mesh-agents.json
```

- Run: `seatmesh kill --help`
- Agent: `seatmesh agent help kill`
- File: [cli/kill.md](cli/kill.md)

## kind

```text
kind <target>  |  kind list  |  kind show <id>
  <target>: agent CLI vs plain terminal (aliases: what, typeof)
  list/show: dump resolved agent kinds (provider kindBase ⋂ agents.kinds overlay
  ⋂ runners shim, extends flattened) — DX for custom-profile kinds
```

- Run: `seatmesh kind --help`
- Agent: `seatmesh agent help kind`
- File: [cli/kind.md](cli/kind.md)

## labels

```text
labels
  Re-apply @mesh_* + border strip
```

- Run: `seatmesh labels --help`
- Agent: `seatmesh agent help labels`
- File: [cli/labels.md](cli/labels.md)

## launch

```text
launch [targets...]
  Start/resume the seat's already-configured CLI (no type pick).
  Empty pane → pick type with spawn. Replace live → switch.
  Examples: launch slot-1 · launch all · launch manager secretary
```

- Run: `seatmesh launch --help`
- Agent: `seatmesh agent help launch`
- File: [cli/launch.md](cli/launch.md)

## layout

```text
layout [--no-leads] [--dry-run] [--yes]
  layout reload [--yes] [--no-leads] [--no-resume]
  layout scale workers|minis up|down|<N> [--yes] [--dry-run]
  layout column list|add <id> [--cli P] [--after ID] [--co-typed]|remove <id>
  Relayout + repair panes from mesh-agents.json (resume). Scale + columns.
  Auto: layout.autoScale.enabled in mesh.config.yaml
```

- Run: `seatmesh layout --help`
- Agent: `seatmesh agent help layout`
- File: [cli/layout.md](cli/layout.md)

## limit

```text
limit idle [--all|--pane %N]
  limit idle-clear
  CC-LIMIT banner → idle (CBs stay armed)
```

- Run: `seatmesh limit --help`
- Agent: `seatmesh agent help limit`
- File: [cli/limit.md](cli/limit.md)

## mds

```text
mds [hosted|agent-self|agent <kind>] …
  Three markdown galleries (CLI ↔ hub /mds):
    hosted [list] | host <file.md> [--as slug] | show|url <slug>
      → .sm/mds/ live files; hub http://127.0.0.1:3190/mds
    agent-self [list] | show <FOCUS.md|TASKS|_shared/…> [--seat col]
      → this seat's FOCUS/TASKS/REMINDER + .sm/seats/_shared
    agent <common|manager|secretary|worker|mini> [show]
      → locked role POV under .sm/roles/_vendor/docs/
  Bare mds / mds status = counts. mdview.io share stays: agent preview <file.md>
  Map: docs/patterns/cli-web-parity.md · docs/cli/mds.md
```

- Run: `seatmesh mds --help`
- Agent: `seatmesh agent help mds`
- File: [cli/mds.md](cli/mds.md)

## migrate-runtime

```text
migrate-runtime [--dry-run]
  Legacy tasks/seatmesh → .sm/runtime (also: update --migrate)
```

- Run: `seatmesh migrate-runtime --help`
- Agent: `seatmesh agent help migrate-runtime`
- File: [cli/migrate-runtime.md](cli/migrate-runtime.md)

## mini

```text
mini list | mini spawn [--role R] <task...>
  mini prompt <N> <text> | mini done <N> PASS|FAIL: …
  mini kill|reassign|dispatch-all
```

- Run: `seatmesh mini --help`
- Agent: `seatmesh agent help mini`
- File: [cli/mini.md](cli/mini.md)

## night

```text
night on|off|status
  Night mode gate for continue
```

- Run: `seatmesh night --help`
- Agent: `seatmesh agent help night`
- File: [cli/night.md](cli/night.md)

## notify

```text
notify "<session>" "<check>" [--url <link>]
  notify info|md "<title>" --md <file>|--body "…" [--image path] [--url https://…]
  notify yesno "<title>" "<blurb>" [--md file|--body "…"] [--image path] [--url https://…]
           [--target seat] [--yes-msg "…"] [--no-msg "…"]
  notify run|cmd "<title>" --cmd "…" [--body "…"] [--cwd rel]
  Operator eyes (beta) — prefer over asking chat for a toast.

  Pick one shape:
    eyes-only   notify "Deploy?" "Check staging" --url http://…
    Info only   notify info "Brief" --body "## Why\n\n…" [--url https://mdview.io/s/…]
                → hub /act/card (:3190). [--url] = Open button (clickable).
                  Bare https:// in body also autolinks. [label](url) works.
                  Mermaid → local Info card renders ```mermaid (mermaid.js). Optional: preview (mdview.io) then --url share.
    Info+Yes/No notify yesno "Ship?" "Need your call" --body "## Diff\n…" [--url https://…]
                → toast buttons Info · Yes · No; card Open if --url.
                Agents may still put links in --body/--md; toast body stays blurb-only.
    Run cmd     notify run "Reload layout" --cmd "sm layout reload"
                → toast **Review** → card shows exact command → **Run** | **Decline**
                  Run never on the toast — only after you see the command on the card.

  yesno args: <title>=decision name · <blurb>=short toast line
  Full recipe: seatmesh agent help notify
```

- Run: `seatmesh notify --help`
- Agent: `seatmesh agent help notify`
- File: [cli/notify.md](cli/notify.md)

## ops

```text
ops list|clear
  Pane-op serial queue
```

- Run: `seatmesh ops --help`
- Agent: `seatmesh agent help ops`
- File: [cli/ops.md](cli/ops.md)

## pane

```text
pane resume [target]
  Autodetect original session id on the pane and resume it.
  Sources: live cmdline → @mesh_oc_session → scrollback → mesh-agents.
  Live OpenCode: paste resume [ses_…]. Else relaunch opencode-cpe/opencode/claude with that id.
  Default target: here. Examples: pane resume · pane resume secretary
```

- Run: `seatmesh pane --help`
- Agent: `seatmesh agent help pane`
- File: [cli/pane.md](cli/pane.md)

## pane-meta

```text
pane-meta <target>
  Raw @mesh_* pane metadata
```

- Run: `seatmesh pane-meta --help`
- Agent: `seatmesh agent help pane-meta`
- File: [cli/pane-meta.md](cli/pane-meta.md)

## peek

```text
peek <target> status|full
  Live pane snapshot / scrollback (manager|slot-N|mini-N|here)
```

- Run: `seatmesh peek --help`
- Agent: `seatmesh agent help peek`
- File: [cli/peek.md](cli/peek.md)

## peer

```text
peer <target> "<msg>" [--ack|--ended [id]] [--direct]
  Enqueue mesh mail to manager|secretary|slot-N|mini-N.
  Cross-mesh: peer @alias:seat "…"  (or: remote <alias> <seat> "…")
  --ack / --ended [id]  close open ask (bare --ack auto-matches)
  ACK/FYI/PROG bodies auto --ack. peer verify [target]
  Shorthands (all agents): ask|msg|tell <t> "…" · ackmsg <t> "…" · reply <id> [msg]
```

- Run: `seatmesh peer --help`
- Agent: `seatmesh agent help peer`
- File: [cli/peer.md](cli/peer.md)

## ppa

```text
ppa [--raw] [--idle SEC]
  Who is slacking? Idle ≥ppa.idleSlackSec (default 120) with open TASKS / BUSY|BLOCKED mark.
  Default = slack verdict. --raw = telemetry table (old perf-index).
  Next: peek <seat> | peer <seat> "CONTINUE …" | remind <slot>
```

- Run: `seatmesh ppa --help`
- Agent: `seatmesh agent help ppa`
- File: [cli/ppa.md](cli/ppa.md)

## preview

```text
preview <file.md...> [--set 1-30] [--notify]
  Publish markdown to mdview.io (https://mdview.io) — NOT a local binary.
  Renders MD + Mermaid in the browser; prints viewerUrl.
  Local hub gallery: mds hosted host <file.md> → .sm/mds + /mds URL
  Examples:
    preview ./handout.md --set 7
    preview ./handout.md --set 7 --notify
  Also: notify info|md "<title>" --md <file>  (same publish, toast+card)
  Docs: https://mdview.io/agents · API POST https://mdview.io/api/public/publish
```

- Run: `seatmesh preview --help`
- Agent: `seatmesh agent help preview`
- File: [cli/preview.md](cli/preview.md)

## profile

```text
profile show
  Dump loaded profile paths
```

- Run: `seatmesh profile --help`
- Agent: `seatmesh agent help profile`
- File: [cli/profile.md](cli/profile.md)

## prompt

```text
prompt [--manager] <target> <text...>
  Enqueue manager→pane inject
```

- Run: `seatmesh prompt --help`
- Agent: `seatmesh agent help prompt`
- File: [cli/prompt.md](cli/prompt.md)

## providers

```text
providers list|scan [session]
  Detect live CLIs
```

- Run: `seatmesh providers --help`
- Agent: `seatmesh agent help providers`
- File: [cli/providers.md](cli/providers.md)

## proxy

```text
proxy status|check|reset
  Profile proxy driver
```

- Run: `seatmesh proxy --help`
- Agent: `seatmesh agent help proxy`
- File: [cli/proxy.md](cli/proxy.md)

## read-history

```text
read-history [N]
  Prompt/response history (same as hub chat). Alias: history | readhistory
  Room lines: room tail [-r slug] [-n N] · hub room
```

- Run: `seatmesh read-history --help`
- Agent: `seatmesh agent help read-history`
- File: [cli/read-history.md](cli/read-history.md)

## realign

```text
realign
  Resize-only: base ratio + equal worker/mini grids
```

- Run: `seatmesh realign --help`
- Agent: `seatmesh agent help realign`
- File: [cli/realign.md](cli/realign.md)

## rebuild

```text
rebuild [--layout]
  Alias of reload — rebuild engine + labels (not "reload config JSON").
```

- Run: `seatmesh rebuild --help`
- Agent: `seatmesh agent help rebuild`
- File: [cli/rebuild.md](cli/rebuild.md)

## reload

```text
reload|rebuild [--layout]
  Rebuild seatmesh packages (npm build) + refresh labels/borders/inbox.
  Does NOT re-read config into live agents / does NOT replace pane CLIs
  (that is spawn/switch/coordSync). --layout re-grids (disruptive).
  Prefer vocal: rebuild
```

- Run: `seatmesh reload --help`
- Agent: `seatmesh agent help reload`
- File: [cli/reload.md](cli/reload.md)

## remind

```text
remind <slot|all> [note...]
  Manager-only worker remind
```

- Run: `seatmesh remind --help`
- Agent: `seatmesh agent help remind`
- File: [cli/remind.md](cli/remind.md)

## remote

```text
remote [--json]
  remote <alias> <seat> "<msg>"
  remote @alias:seat "<msg>"
  Cross-mesh: list other sessions OR peer another mesh.
  Alias: meshes
  Needs remotes.<alias>.profile in mesh.config.yaml (see agent remote / sessions).
  Examples:
    remote
    remote pia secretary "FYI: …"
    remote @pia:secretary "FYI: …"
```

- Run: `seatmesh remote --help`
- Agent: `seatmesh agent help remote`
- File: [cli/remote.md](cli/remote.md)

## reply

```text
reply <ack-id> [msg]
  Shorthand: ack reply <id> [msg] (peer back to asker + close). All agents.
```

- Run: `seatmesh reply --help`
- Agent: `seatmesh agent help reply`
- File: [cli/reply.md](cli/reply.md)

## report

```text
report [--json] [--verbose]
  Stack status (one line default)
```

- Run: `seatmesh report --help`
- Agent: `seatmesh agent help report`
- File: [cli/report.md](cli/report.md)

## roles

```text
roles status|migrate [--to VER]|steps
  Locked role-pack up/down
```

- Run: `seatmesh roles --help`
- Agent: `seatmesh agent help roles`
- File: [cli/roles.md](cli/roles.md)

## room

```text
room tail [-r slug] [-n N] [--truncate N] [--json] | room get <id> [--json]
  room say [-r slug] "<msg>"  (same sender+body within ~20s is deduped, not re-sent)
  room broadcast <msg> | room read | room call|accept …
  A2A ledger. Global default; -r managers|supervise
  broadcast/say fan-out = daemon queue (POST /room-fanout) — not direct-inject storm
```

- Run: `seatmesh room --help`
- Agent: `seatmesh agent help room`
- File: [cli/room.md](cli/room.md)

## save

```text
save|auto [--json] [--no-labels]
  Scrape session → mesh-agents.json
```

- Run: `seatmesh save --help`
- Agent: `seatmesh agent help save`
- File: [cli/save.md](cli/save.md)

## seat

```text
seat init | seat task …
  Prefer: todo give <target> "…"  (see: help todo)
  seat task list|add|check still work; assign = todo give
```

- Run: `seatmesh seat --help`
- Agent: `seatmesh agent help seat`
- File: [cli/seat.md](cli/seat.md)

## secretary

```text
secretary start|stop|status|digest|restart
  secretary supervise on [10m]|run|off
  secretary switch <cli> [--keep-resume]
  Lead supervise path (secretary→manager)
```

- Run: `seatmesh secretary --help`
- Agent: `seatmesh agent help secretary`
- File: [cli/secretary.md](cli/secretary.md)

## session

```text
session attach|up|down|status|sync|check|repair|init <sm-name>
  Session lifecycle. check = config/version/lost files; repair recreates missing
```

- Run: `seatmesh session --help`
- Agent: `seatmesh agent help session`
- File: [cli/session.md](cli/session.md)

## sessions

```text
sessions [--json]
  List other seatmesh meshes (registry + live tmux): dir, port, daemon, peer @alias.
  Agent: list only. Operator: sessions attach|forget|register|pick (no agent).
  Prefer: remote (list + send in one verb)
```

- Run: `seatmesh sessions --help`
- Agent: `seatmesh agent help sessions`
- File: [cli/sessions.md](cli/sessions.md)

## set

```text
set <target> <agent|kiro|claude|opencode|empty>
  Record mesh-agents CLI type
```

- Run: `seatmesh set --help`
- Agent: `seatmesh agent help set`
- File: [cli/set.md](cli/set.md)

## slot-advice

```text
slot-advice <slot|slot-N> [--send] [note...]
  Manager slot coaching
```

- Run: `seatmesh slot-advice --help`
- Agent: `seatmesh agent help slot-advice`
- File: [cli/slot-advice.md](cli/slot-advice.md)

## spawn

```text
spawn <target|1..4> <agent|claude|opencode|kiro> [flags]
  Empty shell → agent CLI (preferred). Default --fast (paste like typing opencode).
  Replace live: switch. Thorough waits: --slow. Ranges: 1..4 · slot-2..5 · mini-1..3
  Examples: spawn slot-1 opencode · spawn 1..3 opencode-cpe · spawn here agent --slow
```

- Run: `seatmesh spawn --help`
- Agent: `seatmesh agent help spawn`
- File: [cli/spawn.md](cli/spawn.md)

## stack

```text
stack …
  Passthrough to profile stack.command. Alias: dc
```

- Run: `seatmesh stack --help`
- Agent: `seatmesh agent help stack`
- File: [cli/stack.md](cli/stack.md)

## start

```text
start
  Init if needed + create-or-attach session
```

- Run: `seatmesh start --help`
- Agent: `seatmesh agent help start`
- File: [cli/start.md](cli/start.md)

## status

```text
status <target> <text...>
  Pane status-left segment
```

- Run: `seatmesh status --help`
- Agent: `seatmesh agent help status`
- File: [cli/status.md](cli/status.md)

## swap

```text
swap <a> <b> [--identity]
  Visual pane swap (same tier). --identity also swaps numbers+seats
```

- Run: `seatmesh swap --help`
- Agent: `seatmesh agent help swap`
- File: [cli/swap.md](cli/swap.md)

## switch

```text
switch <target|1..4> <agent|claude|opencode|kiro|empty> [flags] [reason...]
  Replace a LIVE agent CLI (or → empty). Empty pane → prefer spawn (--fast).
  Alias: handoff. Flags: --fast (skip verify) --slow --keep-resume --resume ID --queue
  Examples: switch slot-1 claude · switch here agent --fast
```

- Run: `seatmesh switch --help`
- Agent: `seatmesh agent help switch`
- File: [cli/switch.md](cli/switch.md)

## tag

```text
tag <target|self> <resume_id|--auto>
  Set resume id on pane
```

- Run: `seatmesh tag --help`
- Agent: `seatmesh agent help tag`
- File: [cli/tag.md](cli/tag.md)

## target

```text
target add "<text>" [--deadline eod|6h]
  target list | target done <id> | target triage <id>
  Operator EOD work items (outside agent). Alias: targets
```

- Run: `seatmesh target --help`
- Agent: `seatmesh agent help target`
- File: [cli/target.md](cli/target.md)

## test

```text
test
  Smoke: layout, providers, inbox, proxy
```

- Run: `seatmesh test --help`
- Agent: `seatmesh agent help test`
- File: [cli/test.md](cli/test.md)

## title

```text
title <target> <text...>
  Pane title
```

- Run: `seatmesh title --help`
- Agent: `seatmesh agent help title`
- File: [cli/title.md](cli/title.md)

## to-master

```text
to-master <msg>
  Deprecated — prefer peer manager / room
```

- Run: `seatmesh to-master --help`
- Agent: `seatmesh agent help to-master`
- File: [cli/to-master.md](cli/to-master.md)

## to-mini

```text
to-mini <N> "<msg>"
  Peer a mini (prefer: peer mini-N)
```

- Run: `seatmesh to-mini --help`
- Agent: `seatmesh agent help to-mini`
- File: [cli/to-mini.md](cli/to-mini.md)

## to-slot

```text
to-slot <N> "<msg>"
  Worker↔worker peer (prefer: peer slot-N)
```

- Run: `seatmesh to-slot --help`
- Agent: `seatmesh agent help to-slot`
- File: [cli/to-slot.md](cli/to-slot.md)

## todo

```text
todo give <target> "<text>"     ← GIVE work (preferred)
  todo <target> "<text>"            ← same shorthand
  todo list [target]
  todo add|check <target> "<text>"  ← file-only add / mark done+report
  (= seat task …). give = FOCUS+TASK+inject+CB≥20m (same as assign).
  check → DONE: to todos.reportTo (default manager). No contracts needed.
  Config: todos.reportTo / todos.checkback in mesh.config.yaml
```

- Run: `seatmesh todo --help`
- Agent: `seatmesh agent help todo`
- File: [cli/todo.md](cli/todo.md)

## update

```text
update [--dry-run] [--migrate] [--no-restart-inbox]
  TWO STEPS — bump the CLI first, then refresh this mesh profile:
    1) npm install -g seatmesh@latest     # or: npx seatmesh@latest …
    2) seatmesh update                    # sync .sm/_vendor from that CLI
  Step 2 alone does NOT upgrade npm. Guide: seatmesh config upgrade
  Also: merge new mesh.config keys; seed seats/_shared; role-pack; paths.json.
  --migrate: legacy tasks/ → .sm/runtime
```

- Run: `seatmesh update --help`
- Agent: `seatmesh agent help update`
- File: [cli/update.md](cli/update.md)

## verify

```text
verify
  Layout + labels health
```

- Run: `seatmesh verify --help`
- Agent: `seatmesh agent help verify`
- File: [cli/verify.md](cli/verify.md)

## version

```text
version [--json] [--check-registry]
  CLI vs npm latest vs profile .seatmesh-version
```

- Run: `seatmesh version --help`
- Agent: `seatmesh agent help version`
- File: [cli/version.md](cli/version.md)

## web

```text
web status|up|down|restart|open|url|help
  Operator hub (packages/web) on http://127.0.0.1:3190 — dashboard / sessions / queues / notify cards.
  Subcommands:
    status [--json]     hub up? + pid/log + daemon tips + routes + registry
    up [--open]         start hub detached (npm run dev in packages/web)
    down                stop hub (pidfile + :3190 listeners)
    restart [--open]    down then up
    open [path]         open hub in browser (alias: open-web)
    url [path]          print hub URL only
  npx / global:
    npx seatmesh web up
    npx seatmesh web status
    npx seatmesh web down
    npx seatmesh web restart --open
  Needs a seatmesh checkout (@seat-mesh/web is private — not on npm).
  Resolves packages/web via: cwd walk-up · SEATMESH_WEB_ROOT · SEATMESH_ROOT · CLI monorepo neighbor.
  Env: SEATMESH_WEB_URL (hub base) · SEATMESH_WEB_ROOT · SEATMESH_ROOT
  Pid/log: ~/.config/seatmesh/web-<port>.{pid,log}
  Also: npm run web (repo root). Map: docs/patterns/cli-web-parity.md · docs/cli/web.md
```

- Run: `seatmesh web --help`
- Agent: `seatmesh agent help web`
- File: [cli/web.md](cli/web.md)

## whoami

```text
whoami [target] [--validate] [--json]
  Identity + retrieval map + open acks/cbs + cold-start FOCUS/TASKS.
  Alias: where
```

- Run: `seatmesh whoami --help`
- Agent: `seatmesh agent help whoami`
- File: [cli/whoami.md](cli/whoami.md)

## missing / card-only

These may appear on older cards but are **not** first-class verbs yet: `snapshot`, `triage`, `nav`.
Prefer `contexts`, `hub`, `target`, and `agent` until implemented.

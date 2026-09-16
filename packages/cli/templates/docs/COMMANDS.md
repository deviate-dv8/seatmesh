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
- `get` → [`hub`](#hub) · [cli/hub.md](cli/hub.md)
- `handoff` → [`switch`](#switch) · [cli/switch.md](cli/switch.md)
- `history` → [`read-history`](#read-history) · [cli/read-history.md](cli/read-history.md)
- `meshes` → [`remote`](#remote) · [cli/remote.md](cli/remote.md)
- `msg` → [`ask`](#ask) · [cli/ask.md](cli/ask.md)
- `operator` → [`human`](#human) · [cli/human.md](cli/human.md)
- `panes` → [`human`](#human) · [cli/human.md](cli/human.md)
- `patience` → [`cb`](#cb) · [cli/cb.md](cli/cb.md)
- `put-agent` → [`human`](#human) · [cli/human.md](cli/human.md)
- `readhistory` → [`read-history`](#read-history) · [cli/read-history.md](cli/read-history.md)
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

## apply

```text
apply … | preflight …
  Legacy multi-clause DSL. Prefer: agent contract on|off
  Example (old): agent apply interval 10m balance manager-2 slot-5
```

- Run: `seatmesh apply --help`
- Agent: `seatmesh agent help apply`
- File: [cli/apply.md](cli/apply.md)

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
balance on|off|status|run [interval]
  Dual-lead work allocation. Prefer: agent contract on balance
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
  chat query […] — history of prompt/response CHAT.jsonl (read-only ledger)
  Not a live group chat. Live A2A = room say/tail · peer ask/msg
  append|record = engine/session writers — agents rarely need these
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
  Then: seatmesh <TAB>. Prefer global bin or alias seatmesh='npx seatmesh'.
```

- Run: `seatmesh completion --help`
- Agent: `seatmesh agent help completion`
- File: [cli/completion.md](cli/completion.md)

## config

```text
config check [--json]
  Validate mesh.config.yaml (YAML + schema + workspace/remotes/paths).
  Run after editing config — before inbox restart or session up.
  Agent: seatmesh agent config check
  Examples:
    config check
    config check --json
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
contract [status|on|off|open]
  Simple harness locks — one path for agents (prefer over apply / raw supervise).

  status                 show supervise/balance ON|OFF
  on [supervise|balance] arm lock + room + tick (default: supervise)
  off [supervise|balance]
  open <slug> --scope "…"   named room (CLAIMED/DONE) — not a lock

  Examples:
    seatmesh agent contract
    seatmesh agent contract on
    seatmesh agent contract on balance
    seatmesh agent contract off
    seatmesh agent contract open slice-a --scope "landing CTA"

  Day-to-day work: todo give / peer / room — contracts optional.
  (agent apply … still works for power users; prefer contract on/off.)
```

- Run: `seatmesh contract --help`
- Agent: `seatmesh agent help contract`
- File: [cli/contract.md](cli/contract.md)

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
  Agent shorthand forum — print the table agents need without grepping the repo.
  Also embedded on every whoami under --- golf ---.
  Alias: golf
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
  Alias for forum — shorthand table (no repo spelunk).
```

- Run: `seatmesh golf --help`
- Agent: `seatmesh agent help golf`
- File: [cli/golf.md](cli/golf.md)

## help

```text
help [cmd]
  Show this index, or usage for one command.
  Humans first: seatmesh help human   ← put an agent on a pane
  Agents: seatmesh agent help [cmd]
  Card:   seatmesh agent
```

- Run: `seatmesh help --help`
- Agent: `seatmesh agent help help`
- File: [cli/help.md](cli/help.md)

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

  Empty terminal → agent:
    switch <target> <opencode|claude|agent|kiro>
    Examples:
      seatmesh switch slot-1 opencode
      seatmesh switch secretary claude
      seatmesh switch here agent          # this pane (Cursor)
      npx seatmesh switch mini-1 opencode

  Back to plain shell:
    switch <target> empty

  Start/resume the seat's configured CLI (no type pick):
    launch <target|all|manager|secretary>

  Check agent vs shell:
    kind <target>     # aliases: what | typeof

  Give the seat WORK / a todo (does NOT install a CLI — different from switch):
    todo give <target> "do the thing"     # preferred
    todo <target> "do the thing"          # shorthand
    assign <target> "do the thing"        # same engine

  Targets: manager | secretary | slot-N | mini-N | here
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

## kind

```text
kind <target>
  Agent CLI vs plain terminal. Aliases: what, typeof
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
  To choose opencode/claude/agent on an empty pane: switch (help human)
  Examples: launch slot-1 · launch all · launch manager secretary
```

- Run: `seatmesh launch --help`
- Agent: `seatmesh agent help launch`
- File: [cli/launch.md](cli/launch.md)

## layout

```text
layout [--no-leads] [--dry-run] [--yes]
  layout column list|add <id> [--cli P] [--after ID] [--co-typed]|remove <id>
  Workers/minis grid + N base columns
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
notify link|url|open "<title>" --url <https> [--check "…"]
  notify "<session>" "<check>" [--url <link>]
  notify info|md "<title>" --md <file>|--body "…" [--image path] [--url https://…]
  notify yesno "<title>" "<blurb>" [--md file|--body "…"] [--image path] [--url https://…]
           [--target seat] [--yes-msg "…"] [--no-msg "…"]
  Operator eyes (beta) — prefer over asking chat for a toast.

  Pick one shape:
    link-only   notify link "Staging" --url http://127.0.0.1:5080
                → toast Open button → URL (no Info card). Same: notify "…" "…" --url
    Info only   notify info "Brief" --body "## Why\n\n…" [--url https://mdview.io/s/…]
                → local /act/card. [--url] = Open button on card.
                  Bare https:// in body also autolinks. [label](url) works.
                Mermaid → local Info card renders ```mermaid (mermaid.js). Optional: preview (mdview.io) then --url share.
    Info+Yes/No notify yesno "Ship?" "Need your call" --body "## Diff\n…" [--url https://…]
                → toast buttons Info · Yes · No; card Open if --url.
                Agents may still put links in --body/--md; toast body stays blurb-only.

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
  LEGACY catch-all inject. Prefer:
    todo give <target> "…"   — give work + CB
    ask|msg <target> "…"     — peer ask/send
    peer <target> "…"        — full peer
  Still works for leads; prints a prefer-hint on use.
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

## reload

```text
reload [--layout]
  Rebuild engine + labels (no session kill). --layout re-grids
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
  remote @alias:seat "<msg>"
  remote <alias> <seat> "<msg>"   (legacy — prefer @ form)
  Cross-mesh: list other sessions OR peer another mesh.
  Alias: meshes
  Needs remotes.<alias>.profile in mesh.config.yaml (see agent remote / sessions).
  Examples:
    remote
    remote @pia:secretary "FYI: …"
    peer @seatmesh:manager "ACK …"
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
room tail [-r slug] [-n N] | room say [-r slug] "<msg>"
  Modern path: say/tail (+ contract open <slug> for named ledgers).
  Prefer CLAIMED|DONE|FYI|STATUS lines over room call/accept (legacy A2A dial).
  Also: room broadcast <msg> | room read | room create <slug>
  Legacy: room call|accept|decline|pending (workers) — prefer peer ask/msg instead
  Global default; -r managers|supervise
  broadcast/say fan-out = daemon queue (POST /room-fanout)
```

- Run: `seatmesh room --help`
- Agent: `seatmesh agent help room`
- File: [cli/room.md](cli/room.md)

## run

```text
run
  Operator shell for the logs window (left pane).
  Prints session/inbox one-liner, then drops into $SHELL in the workspace.
  Used by: logs window · npx seatmesh run
```

- Run: `seatmesh run --help`
- Agent: `seatmesh agent help run`
- File: [cli/run.md](cli/run.md)

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
secretary start|status|digest|restart
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
switch <target> <agent|claude|opencode|kiro|empty> [flags] [reason...]
  HUMAN: empty terminal → agent CLI (or empty = back to shell).
  Alias: handoff. See: seatmesh help human
  Examples: switch slot-1 opencode · switch here claude · switch mini-2 empty
  Flags: --keep-resume --resume ID --queue
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
  Refresh _vendor + AGENTS.md; merge humanCoTyped/logs; seed seats/_shared;
  role-pack migrate; paths.json. --migrate also legacy tasks/ → .sm/
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

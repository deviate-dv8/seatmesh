/**
 * Quick help for agents + operators — one place for `help <cmd>` / `<cmd> --help`.
 * Prefer short usage blocks; deep docs stay in ONE-PATH / AGENTS.md.
 */

const ALIASES: Record<string, string> = {
  get: "hub",
  history: "read-history",
  readhistory: "read-history",
  seats: "contexts",
  where: "whoami",
  what: "kind",
  typeof: "kind",
  checkback: "cb",
  patience: "cb",
  coldstart: "cold-start",
  handoff: "switch",
  empty: "kill",
  /** Rebuild engine + labels (prefer vocal over misleading "reload"). */
  rebuild: "reload",
  targets: "target",
  dc: "stack",
  cc: "switch",
  meshes: "remote",
  ask: "ask",
  msg: "ask",
  tell: "ask",
  ackmsg: "ackmsg",
  answered: "ackmsg",
  reply: "reply",
  todos: "todo",
  "put-agent": "human",
  panes: "human",
  operator: "human",
  "open-web": "web",
};

/** Canonical verb → multi-line usage (first line is summary). */
const HELP: Record<string, string> = {
  help: `help [cmd]
  Operator default = human surface only (agent verbs hidden).
  Full list: seatmesh --agents help
  One verb:  seatmesh help <cmd> · seatmesh agent help <cmd>
  Put agent: seatmesh help human`,

  human: `human — put an agent CLI on a pane (operator)

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
  Aliases for this topic: help put-agent | help panes | help operator`,

  completion: `completion bash|zsh|fish|reply|install
  Shell tab completion. Enable: eval "$(seatmesh completion zsh)"
  Then: sm <TAB>. Prefer global bin: sm install  (legacy: seatmesh).`,

  agent: `agent
  Print can/cannot for THIS pane (gateway card).
  agent help [cmd]     usage for one verb
  agent <cmd> …        run if allowed; else UNAUTHORIZED
  agent whoami         full hub dump every turn`,

  whoami: `whoami [target] [--validate] [--json]
  Identity + retrieval map + open acks/cbs + cold-start FOCUS/TASKS.
  Alias: where`,

  hub: `hub [contexts|todos|acks|cbs|chat|room|shared|sessions]
  Retrieval + CRUD map; bare hub = guide + live summary for this seat.
  Alias: get
  Examples:
    hub todos | hub acks | hub sessions | hub chat 40 | hub room supervise`,

  "read-history": `read-history [N]
  Prompt/response history (same as hub chat). Alias: history | readhistory
  Room lines: room tail [-r slug] [-n N] · hub room`,

  sessions: `sessions [--json]
  List other seatmesh meshes (registry + live tmux): dir, port, daemon, peer @alias.
  Agent: list only. Operator: sessions attach|forget|register|pick (no agent).
  Prefer: remote (list + send in one verb)`,

  remote: `remote [--json]
  remote <alias> <seat> "<msg>"
  remote @alias:seat "<msg>"
  Cross-mesh: list other sessions OR peer another mesh.
  Alias: meshes
  Needs remotes.<alias>.profile in mesh.config.yaml (see agent remote / sessions).
  Examples:
    remote
    remote pia secretary "FYI: …"
    remote @pia:secretary "FYI: …"`,

  peer: `peer <target> "<msg>" [--ack|--ended [id]] [--direct]
  Enqueue mesh mail to manager|secretary|slot-N|mini-N.
  Cross-mesh: peer @alias:seat "…"  (or: remote <alias> <seat> "…")
  --ack / --ended [id]  close open ask (bare --ack auto-matches)
  ACK/FYI/PROG bodies auto --ack. peer verify [target]
  Shorthands (all agents): ask|msg|tell <t> "…" · ackmsg <t> "…" · reply <id> [msg]`,

  ask: `ask <target> "<msg>"
  Shorthand: peer <target> "<msg>" (send / open ask). All agents.
  Also: msg|tell <target> "<msg>"`,

  ackmsg: `ackmsg <target> "<msg>"
  Shorthand: peer --ack <target> "<msg>" (reply + close open ask). All agents.
  Alias: answered`,

  reply: `reply <ack-id> [msg]
  Shorthand: ack reply <id> [msg] (peer back to asker + close). All agents.`,

  contexts: `contexts [--json]
  Seat map (slots/minis/HQ) with open TASK counts + FOCUS preview.
  Alias: seats`,

  ack: `ack | ack list | ack <id> [note] | ack reply <id> [msg] | ack clear
  List/close unanswered asks. Chat prose does NOT clear.
  ack reply = peer back to asker + close (default msg ACK).
  Lead: ack redirect <mini-N>`,

  cb: `cb list | cb start <dur> --expect "…" [--here]
  cb cancel <id> | cb cancel-all | cb reset <id> <dur> | cb ack <id> yes|no
  Poll-later timers (aliases: checkback, patience). Chat does NOT cancel.`,

  room: `room tail [-r slug] [-n N] [--truncate N] [--json] | room get <id> [--json]
  room say [-r slug] "<msg>"  (same sender+body within ~20s is deduped, not re-sent)
  room broadcast <msg> | room read | room call|accept …
  A2A ledger. Global default; -r managers|supervise
  broadcast/say fan-out = daemon queue (POST /room-fanout) — not direct-inject storm`,

  chat: `chat tail [--slot key] [--lines N] [--json]
  chat query [--slot|--session|--model|--since|--limit] [--json]
  chat put <slot> "<human>" [--response "<text>"]  (positional upsert, dedupe by turnHash)
  chat get <id> [--slot key] [--json]  (id or turnHash, full or 8-char prefix)
  chat append|record  — per-slot prompt/response CHAT.jsonl`,

  notify: `notify "<session>" "<check>" [--url <link>]
  notify info|md "<title>" --md <file>|--body "…" [--image path] [--url https://…]
  notify yesno "<title>" "<blurb>" [--md file|--body "…"] [--image path] [--url https://…]
           [--target seat] [--yes-msg "…"] [--no-msg "…"]
  notify run|cmd "<title>" --cmd "…" [--body "…"] [--cwd rel]
  Operator eyes (beta) — prefer over asking chat for a toast.

  Pick one shape:
    eyes-only   notify "Deploy?" "Check staging" --url http://…
    Info only   notify info "Brief" --body "## Why\\n\\n…" [--url https://mdview.io/s/…]
                → hub /act/card (:3190). [--url] = Open button (clickable).
                  Bare https:// in body also autolinks. [label](url) works.
                  Mermaid → local Info card renders \`\`\`mermaid (mermaid.js). Optional: preview (mdview.io) then --url share.
    Info+Yes/No notify yesno "Ship?" "Need your call" --body "## Diff\\n…" [--url https://…]
                → toast buttons Info · Yes · No; card Open if --url.
                Agents may still put links in --body/--md; toast body stays blurb-only.
    Run cmd     notify run "Reload layout" --cmd "sm layout reload"
                → toast **Review** → card shows exact command → **Run** | **Decline**
                  Run never on the toast — only after you see the command on the card.

  yesno args: <title>=decision name · <blurb>=short toast line
  Full recipe: seatmesh agent help notify`,

  peek: `peek <target> status|full
  Live pane snapshot / scrollback (manager|slot-N|mini-N|here)`,

  kind: `kind <target>  |  kind list  |  kind show <id>
  <target>: agent CLI vs plain terminal (aliases: what, typeof)
  list/show: dump resolved agent kinds (provider kindBase ⋂ agents.kinds overlay
  ⋂ runners shim, extends flattened) — DX for custom-profile kinds`,

  inbox: `inbox [--json] [--wait N] [--meta]
  inbox list|resolve|log|instances|stop|restart
  Daemon queue status (restart is lead/operator)`,

  seat: `seat init | seat task …
  Prefer: todo give <target> "…"  (see: help todo)
  seat task list|add|check still work; assign = todo give`,

  todo: `todo give <target> "<text>"     ← GIVE work (preferred)
  todo <target> "<text>"            ← same shorthand
  todo list [target]
  todo add|check <target> "<text>"  ← file-only add / mark done+report
  (= seat task …). give = FOCUS+TASK+inject+CB≥20m (same as assign).
  check → DONE: to todos.reportTo (default manager). No contracts needed.
  Config: todos.reportTo / todos.checkback in mesh.config.yaml`,

  assign: `assign <target> "<text>"
  Same as: todo give <target> "…"  (FOCUS NOW + TASK + peer inject + CB≥20m).
  Prefer the todo verb. Does NOT put a CLI on the pane — use switch (help human)`,

  prompt: `prompt [--manager] <target> <text...>
  Enqueue manager→pane inject`,

  remind: `remind <slot|all> [note...]
  Manager-only worker remind`,

  mini: `mini list | mini spawn [--role R] <task...>
  mini prompt <N> <text> | mini done <N> PASS|FAIL: …
  mini kill|reassign|dispatch-all`,

  secretary: `secretary start|stop|status|digest|restart
  secretary supervise on [10m]|run|off
  secretary switch <cli> [--keep-resume]
  Lead supervise path (secretary→manager)`,

  spawn: `spawn <target|1..4> <agent|claude|opencode|kiro> [flags]
  Empty shell → agent CLI (preferred). Default --fast (paste like typing opencode).
  Replace live: switch. Thorough waits: --slow. Ranges: 1..4 · slot-2..5 · mini-1..3
  Examples: spawn slot-1 opencode · spawn 1..3 opencode-cpe · spawn here agent --slow`,

  switch: `switch <target|1..4> <agent|claude|opencode|kiro|empty> [flags] [reason...]
  Replace a LIVE agent CLI (or → empty). Empty pane → prefer spawn (--fast).
  Alias: handoff. Flags: --fast (skip verify) --slow --keep-resume --resume ID --queue
  Examples: switch slot-1 claude · switch here agent --fast`,

  forum: `forum | golf
  Print the real shorthand table (Ruby ranges + one verb per job).
  Alias: golf. Also: sm agent forum`,

  golf: `golf
  Alias for forum — shorthand table (no repo spelunk)`,

  swap: `swap <a> <b> [--identity]
  Visual pane swap (same tier). --identity also swaps numbers+seats`,

  launch: `launch [targets...]
  Start/resume the seat's already-configured CLI (no type pick).
  Empty pane → pick type with spawn. Replace live → switch.
  Examples: launch slot-1 · launch all · launch manager secretary`,

  pane: `pane resume [target]
  Autodetect original session id on the pane and resume it.
  Sources: live cmdline → @mesh_oc_session → scrollback → mesh-agents.
  Live OpenCode: paste resume [ses_…]. Else relaunch opencode-cpe/opencode/claude with that id.
  Default target: here. Examples: pane resume · pane resume secretary`,

  flush: `flush <slot|all|manager|mini-N>
  Rescue stuck composer Enter`,

  continue: `continue <slot|all> [note...]
  Night continue (manager-only; requires night on)`,

  night: `night on|off|status
  Night mode gate for continue`,

  set: `set <target> <agent|kiro|claude|opencode|empty>
  Record mesh-agents CLI type`,

  tag: `tag <target|self> <resume_id|--auto>
  Set resume id on pane`,

  title: `title <target> <text...>
  Pane title`,

  status: `status <target> <text...>
  Pane status-left segment`,

  "cold-start": `cold-start [target] [--inject] [--force]
  Print (or enqueue) cold-start brief. Alias: coldstart`,

  limit: `limit idle [--all|--pane %N]
  limit idle-clear
  CC-LIMIT banner → idle (CBs stay armed)`,

  update: `update [--dry-run] [--migrate] [--no-restart-inbox]
  TWO STEPS — bump the CLI first, then refresh this mesh profile:
    1) npm install -g seatmesh@latest     # or: npx seatmesh@latest …
    2) seatmesh update                    # sync .sm/_vendor from that CLI
  Step 2 alone does NOT upgrade npm. Guide: seatmesh config upgrade
  Also: merge new mesh.config keys; seed seats/_shared; role-pack; paths.json.
  --migrate: legacy tasks/ → .sm/runtime`,

  config: `config check [--json] | config upgrade
  check: validate mesh.config.yaml + paths
  upgrade: how to get latest seatmesh CLI (npm i -g seatmesh@latest) then update`,

  web: `web status|up|down|restart|open|url|help
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
  Also: npm run web (repo root). Map: docs/patterns/cli-web-parity.md · docs/cli/web.md`,

  init: `init [--force] [--seats-root PATH] [--name NAME]
  Create project .sm/ (human). Prefer: start`,

  start: `start
  Init if needed + create-or-attach session`,

  session: `session attach|up|down|status|sync|check|repair|init <sm-name>
  Session lifecycle. check = config/version/lost files; repair recreates missing`,

  reload: `reload|rebuild [--layout]
  Rebuild seatmesh packages (npm build) + refresh labels/borders/inbox.
  Does NOT re-read config into live agents / does NOT replace pane CLIs
  (that is spawn/switch/coordSync). --layout re-grids (disruptive).
  Prefer vocal: rebuild`,

  rebuild: `rebuild [--layout]
  Alias of reload — rebuild engine + labels (not "reload config JSON").`,

  layout: `layout [--no-leads] [--dry-run] [--yes]
  layout reload [--yes] [--no-leads] [--no-resume]
  layout scale workers|minis up|down|<N> [--yes] [--dry-run]
  layout column list|add <id> [--cli P] [--after ID] [--co-typed]|remove <id>
  Relayout + repair panes from mesh-agents.json (resume). Scale + columns.
  Auto: layout.autoScale.enabled in mesh.config.yaml`,

  kill: `kill <target|1..4|slot-N|mini-N|here>
  Alias: empty. Respawn pane to plain terminal + save type=empty in mesh-agents.json`,

  empty: `empty <target|1..4|slot-N|mini-N|here>
  Alias of kill — pane → plain terminal, mesh-agents saved empty`,

  realign: `realign
  Resize-only: base ratio + equal worker/mini grids`,

  save: `save|auto [--json] [--no-labels]
  Scrape session → mesh-agents.json`,

  auto: `auto [--json] [--no-labels]
  Alias of save (scrape session)`,

  labels: `labels
  Re-apply @mesh_* + border strip`,

  verify: `verify
  Layout + labels health`,

  report: `report [--json] [--verbose]
  Stack status (one line default)`,

  test: `test
  Smoke: layout, providers, inbox, proxy`,

  version: `version [--json] [--check-registry]
  CLI vs npm latest vs profile .seatmesh-version`,

  roles: `roles status|migrate [--to VER]|steps
  Locked role-pack up/down`,

  host: `host up|down|status
  Opt-in single host-supervisor: one process watches all meshes registered in
  ~/.config/seatmesh/sessions.json instead of each spawning its own supervisor.
  Does not affect meshes that haven't opted in (Phase 1, see NOW.md).`,

  target: `target add "<text>" [--deadline eod|6h]
  target list | target done <id> | target triage <id>
  Operator EOD work items (outside agent). Alias: targets`,

  ops: `ops list|clear
  Pane-op serial queue`,

  proxy: `proxy status|check|reset
  Profile proxy driver`,

  providers: `providers list|scan [session]
  Detect live CLIs`,

  base: `base ensure|realign
  Base window helpers`,

  index: `index show|validate
  Role index paths`,

  profile: `profile show
  Dump loaded profile paths`,

  stack: `stack …
  Passthrough to profile stack.command. Alias: dc`,

  preview: `preview <file.md...> [--set 1-30] [--notify]
  Publish markdown to mdview.io (https://mdview.io) — NOT a local binary.
  Renders MD + Mermaid in the browser; prints viewerUrl.
  Local hub gallery: mds hosted host <file.md> → .sm/mds + /mds URL
  Examples:
    preview ./handout.md --set 7
    preview ./handout.md --set 7 --notify
  Also: notify info|md "<title>" --md <file>  (same publish, toast+card)
  Docs: https://mdview.io/agents · API POST https://mdview.io/api/public/publish`,

  nav: `nav log [-n N] [--json]
  nav summary [-n N] [--json]
  Navigation history — recent \`peek <target>\` events (which panes/seats you've
  looked at). log = chronological, summary = grouped by target, most-recent first.`,

  skill: `--skill [--json] (also: seatmesh skill)
  Discovery/capability manifest for another tool or agent integrating with
  seatmesh — what it does, when to reach for it, entry points, and the full
  command list. Plain shell-out integration (no SDK) — works from anywhere,
  no .sm/ workspace needed. --json for machine-readable output.`,

  campaign: `campaign create <title> [--objective "..."] [--assign <seat>] [--json]
  campaign list [--status open|done|cancelled|all] [--json]
  campaign show <id> [--json]
  campaign assign <id> <seat>
  campaign done|cancel|reopen <id>
  campaign note <id> "<text>"
  Ticket-style campaigns (TODO 8.2/8.4) — one atomic work unit: title, objective
  (what "done" means), status, optional assignee, freeform notes. Purely additive,
  its own event log — no dependency graph, no supervisor/balancer roles yet.`,

  schedule: `schedule <target> "<msg...>" --at <time>
  Delayed one-shot peer — queues now, held out of drain until --at passes
  (ISO time or relative duration: 10m, 2h, 1d). Fire-and-forget: no ACK
  tracking opens until it's actually delivered.
  Examples: schedule secretary "EOD digest" --at 6h · schedule slot-2 "follow up" --at 2026-09-20T09:00:00Z`,

  mds: `mds [hosted|agent-self|agent <kind>] …
  Three markdown galleries (CLI ↔ hub /mds):
    hosted [list] | host <file.md> [--as slug] | show|url <slug>
      → .sm/mds/ live files; hub http://127.0.0.1:3190/mds
    agent-self [list] | show <FOCUS.md|TASKS|_shared/…> [--seat col]
      → this seat's FOCUS/TASKS/REMINDER + .sm/seats/_shared
    agent <common|manager|secretary|worker|mini> [show]
      → locked role POV under .sm/roles/_vendor/docs/
  Bare mds / mds status = counts. mdview.io share stays: agent preview <file.md>
  Map: docs/patterns/cli-web-parity.md · docs/cli/mds.md`,

  contract: `contract [status]
  contract show <id>
  contract on|off <id> [--agent <seat>]
  contract create|open <slug>
  Easy locks: status = vendor + ON/off. on/off default agent from yaml
  (supervise→secretary, balance→balance_lead). No --agent needed.`,

  balance: `balance …
  Dual-lead balance (coord)`,

  "to-slot": `to-slot <N> "<msg>"
  Worker↔worker peer (prefer: peer slot-N)`,

  "to-mini": `to-mini <N> "<msg>"
  Peer a mini (prefer: peer mini-N)`,

  "to-master": `to-master <msg>
  Deprecated — prefer peer manager / room`,

  "slot-advice": `slot-advice <slot|slot-N> [--send] [note...]
  Manager slot coaching`,

  "pane-meta": `pane-meta <target>
  Raw @mesh_* pane metadata`,

  capture: `capture [target] [--lines N] [--ansi] [--json]
  Read-only pane scrollback dump (default: here, last 80 lines)`,

  ppa: `ppa [--raw] [--idle SEC]
  Who is slacking? Idle ≥ppa.idleSlackSec (default 120) with open TASKS / BUSY|BLOCKED mark.
  Default = slack verdict. --raw = telemetry table (old perf-index).
  Next: peek <seat> | peer <seat> "CONTINUE …" | remind <slot>`,

  "migrate-runtime": `migrate-runtime [--dry-run]
  Legacy tasks/seatmesh → .sm/runtime (also: update --migrate)`,

  func: `func <id> <args...>
  Profile funcs: registry (external.default + role allow)`,
};

export function resolveHelpVerb(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/^-+/, "");
  return ALIASES[v] ?? v;
}

export function wantsCmdHelp(argv: string[]): boolean {
  const args = argv.slice(1);
  if (args[0] === "help") return true;
  return args.some((a) => a === "-h" || a === "--help");
}

export function printGlobalHelpHint(agentsHelp = false): void {
  console.log("hint: seatmesh help human  # put an agent CLI on a pane");
  if (agentsHelp) {
    console.log("hint: seatmesh --agents help  # full human+agent list (this mode)");
  } else {
    console.log("hint: seatmesh help = human-only · seatmesh --agents help = full list");
  }
  console.log("hint: seatmesh help <cmd> | seatmesh agent help <cmd>");
  console.log("hint: seatmesh completion install  # tab: seatmesh <TAB> / sm <TAB>");
  console.log("docs: docs/COMMANDS.md · docs/cli/<verb>.md · docs/ONE-PATH.md · .sm/AGENTS.md");
}

/** @returns true if known verb printed. */
export function printCmdHelp(rawVerb: string): boolean {
  const verb = resolveHelpVerb(rawVerb);
  const body = HELP[verb];
  if (!body) {
    console.error(`unknown command for help: ${rawVerb}`);
    printGlobalHelpHint();
    return false;
  }
  console.log(body.trimEnd());
  if (verb !== "help" && verb !== "agent" && verb !== "human" && verb !== "completion") {
    console.log("");
    console.log(`also: seatmesh agent help ${verb}`);
  }
  return true;
}

/** Compact index of verbs agents use most. */
export function printAgentHelpIndex(): void {
  console.log(`agent help — quick usage

Every turn:
  seatmesh agent whoami
  seatmesh agent              # can / cannot for this pane
  seatmesh agent help <cmd>   # usage for one verb

Retrieve:
  hub | hub todos|acks|cbs|chat|room|shared|sessions

Cross-mesh:
  remote                         # list other meshes
  remote pia secretary "…"       # send
  remote @pia:secretary "…"      # same
  sessions                       # list only

Comms:
  ask|msg <t> "…" · ackmsg <t> "…" · reply <id> · peer · room · ack · cb · notify · todo

Also: seatmesh help <cmd>  (same map; works outside agent)
`);
}

export function listHelpVerbs(): string[] {
  return Object.keys(HELP).sort();
}

export function listHelpEntries(): { verb: string; body: string }[] {
  return Object.entries(HELP)
    .map(([verb, body]) => ({ verb, body: body.trimEnd() }))
    .sort((a, b) => a.verb.localeCompare(b.verb));
}

export function listHelpAliases(): { alias: string; verb: string }[] {
  return Object.entries(ALIASES)
    .map(([alias, verb]) => ({ alias, verb }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

/** Greppable catalog for docs/COMMANDS.md (keep in sync via gen script / test). */
export function renderCommandsMarkdown(): string {
  const lines: string[] = [
    "# seatmesh commands",
    "",
    "Greppable usage catalog for every CLI verb. **Source of truth:**",
    "`packages/cli/src/commands/help-text.ts` (also drives `seatmesh help <cmd>`).",
    "",
    "```bash",
    "# list all verbs",
    'rg -n "^## " docs/COMMANDS.md',
    "",
    "# find one verb",
    'rg -n "^## peer$|^## whoami$" docs/COMMANDS.md',
    "",
    "# one file per verb",
    "ls docs/cli | rg peer",
    "rg -n . docs/cli/peer.md",
    "",
    "# runtime help (same text)",
    "seatmesh help peer",
    "seatmesh agent help peer",
    "seatmesh peer --help",
    "```",
    "",
    "| Job | Doc |",
    "|-----|-----|",
    "| One command per goal | [ONE-PATH.md](ONE-PATH.md) |",
    "| Agent gateway card | `.sm/AGENTS.md` · `seatmesh agent` |",
    "| Per-verb markdown | [cli/](cli/) |",
    "",
    "## aliases",
    "",
  ];

  for (const { alias, verb } of listHelpAliases()) {
    lines.push(`- \`${alias}\` → [\`${verb}\`](#${verb}) · [cli/${verb}.md](cli/${verb}.md)`);
  }

  lines.push("");

  for (const { verb, body } of listHelpEntries()) {
    lines.push(`## ${verb}`);
    lines.push("");
    lines.push("```text");
    lines.push(body);
    lines.push("```");
    lines.push("");
    lines.push(`- Run: \`seatmesh ${verb} --help\``);
    lines.push(`- Agent: \`seatmesh agent help ${verb}\``);
    lines.push(`- File: [cli/${verb}.md](cli/${verb}.md)`);
    lines.push("");
  }

  lines.push("## missing / card-only");
  lines.push("");
  lines.push(
    "These may appear on older cards but are **not** first-class verbs yet: `snapshot`, `triage`, `nav`.",
  );
  lines.push("Prefer `contexts`, `hub`, `target`, and `agent` until implemented.");
  lines.push("");

  return lines.join("\n");
}

/** One short md per verb under docs/cli/. */
export function renderCliVerbMarkdown(verb: string): string | null {
  const body = HELP[verb];
  if (!body) return null;
  const aliases = listHelpAliases()
    .filter((a) => a.verb === verb)
    .map((a) => a.alias);
  const lines = [
    `# seatmesh ${verb}`,
    "",
    "```text",
    body.trimEnd(),
    "```",
    "",
    `- CLI: \`seatmesh ${verb} --help\``,
    `- Agent: \`seatmesh agent help ${verb}\``,
    `- Catalog: [../COMMANDS.md#${verb}](../COMMANDS.md#${verb})`,
  ];
  if (aliases.length) {
    lines.push(`- Aliases: ${aliases.map((a) => `\`${a}\``).join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

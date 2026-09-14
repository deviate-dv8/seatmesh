#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { findDotSmConfig } from "@seat-mesh/core";
import {
  loadProfile,
  profilePaths,
  loadRoleIndex,
  renderRoleIndex,
  validateRoleIndex,
  runStackPassthrough,
  roleAllows,
  isCoordKind,
  isManagerKind,
  managerColumnIds,
  addBaseColumn,
  removeBaseColumn,
  listBaseColumns,
} from "@seat-mesh/core";
import { snapshotConnectivity, formatStatus } from "@seat-mesh/connectivity";
import { createRegistryForProfile } from "@seat-mesh/providers";
import {
  printWhoami,
  whoamiJson,
  whoamiJsonWithValidate,
  validateWhoamiRoleIndex,
  printAgentCard,
  printAgentContext,
  printAgentContextAllRoles,
  runWhoami,
  roleKindFromWhoami,
  requireCoordRole,
  requireInboxLifecycleRole,
  capturePaneSnapshot,
  listSessionPanes,
  sessionAttach,
  sessionUp,
  sessionStatus,
  relayoutMeshSession,
  realignAllLayouts,
  reloadMesh,
  ensureMeshInbox,
  startMeshInbox,
  stopMeshInbox,
  restartMeshInbox,
  meshInboxEverConfigured,
  meshInboxPort,
  printMeshInboxStatus,
  waitForMeshInbox,
  printInboxMeta,
  tailInboxLog,
  listInboxInstances,
  parseInboxStatusFlags,
  inboxStatusArgv,
  listInbox,
  resolveInbox,
  secretaryLaunch,
  secretaryRestart,
  secretaryDispatch,
  secretaryCollect,
  secretaryMeshWatch,
  secretarySupervise,
  secretaryStatus,
  printMiniList,
  miniSpawn,
  miniPrompt,
  miniDone,
  miniSpawnAll,
  runMeshSmoke,
  printSmokeResults,
  launchSession,
  printLaunchResults,
  enqueuePrompt,
  injectPromptDirect,
  printPeerVerify,
  runPeerVerify,
  runRemind,
  printRemindResults,
  runNight,
  runContinue,
  printContinueResults,
  runSlotAdvice,
  verifyMeshSession,
  printVerify,
  labelMeshSession,
  liveMeshSession,
  ensureBaseLayout,
  realignBaseLayout,
  applyMeshSessionBorders,
  runFlush,
  printFlushResults,
  runSwitch,
  runSet,
  runTag,
  setPaneTitle,
  setPaneStatus,
  printSeatContexts,
  runPeek,
  runPaneMeta,
  runPpa,
  runToSlot,
  runToMini,
  runPeer,
  parseRemotePeerTarget,
  runRemotePeer,
  applyMeshState,
  saveMeshSession,
  saveMeshSessionDetailed,
  assertSaveAllowed,
  formatSaveSummary,
  submitPaneOp,
  clearPaneOpsQueue,
  printPaneOpsList,
  printRelayoutPlan,
  assertRelayoutSafe,
  buildColdStartBrief,
  buildFullColdStartBrief,
  enqueueColdStart,
  runSeatInit,
  applyAgentContractBundle,
  balanceLeadCommand,
} from "@seat-mesh/tmux";
import { parseAgentApplyArgs } from "@seat-mesh/core";
import { buildChatCommands } from "./commands/chat-cli.js";
import { buildCheckbackCommands } from "./commands/checkback-cli.js";
import { buildNotifyCommand } from "./commands/notify-cli.js";
import { buildPreviewCommand } from "./commands/preview-cli.js";
import { buildContractLockCommands } from "./commands/contract-lock-cli.js";
import { buildRoomCommands } from "./commands/room-cli.js";
import { runInit } from "./setup/init.js";
import { runAgentContextInit } from "./setup/agent-context-init.js";
import { runSeatCommand } from "./commands/seat-cli.js";
import { coordCommand } from "./commands/coord-cli.js";

function parseArgs(argv: string[]) {
  const profileFlag: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile" || a === "-p") {
      const v = argv[++i];
      if (!v) throw new Error("--profile requires a path");
      profileFlag.push(v);
      continue;
    }
    rest.push(a);
  }
  return { profile: profileFlag[0], rest };
}

/** Profile yaml + mesh-agents.json layout overrides (yaml is fallback only). */
function meshLoaded(profileArg?: string) {
  return applyMeshState(loadProfile(profileArg));
}

function usage(loaded?: ReturnType<typeof loadProfile>): void {
  const prof = loaded ? `profile=${loaded.profile.name}` : "";
  console.log(`seatmesh${prof ? ` (${prof})` : ""} — profile-driven tmux multi-agent CLI

  Docs: README.md + docs/ONE-PATH.md + docs/QUICKSTART.md
  Cold start: bin/seatmesh auto-runs npm install + build when dist is stale

Setup (run once per project, by a human)
  start               init (if no .sm/ here) + session up, in one step
  init [--force] [--seats-root PATH] [--name NAME]   create .sm/ dotdir
  sessions [pick|list|attach|forget|register] [--json]   global registry + TUI picker
  update [--dry-run] [--migrate] [--no-restart-inbox]
                                        refresh _vendor (file-by-file) + paths.json; restart inbox

Status / diagnostics
  report [--json] [--verbose]   stack status (one line default; --verbose = full section dump)
  verify              layout + labels health
  test                          smoke: layout, providers, inbox, proxy

Session / layout (infra shape, operator or manager)
  session attach|up|status
  reload [--layout]   rebuild engine + labels (no session kill; --layout re-grids)
  layout [--no-leads] [--dry-run] [--yes]   workers + minis grid (queued)
  layout column list|add <id> [--cli P] [--after ID] [--co-typed]|remove <id>
                                 N base columns (managers/secretaries) are config, not enum
  realign               resize-only: base ratio + worker/mini equal grids
  ops list|clear                pane-op queue (serial)
  save|auto [--json] [--no-labels]   scrape session -> mesh-agents.json (+ labels; daemon auto-scrapes every 10m)
  labels                        re-apply @mesh_* + border strip
  inbox [--json] [--wait N] [--meta] | inbox list|resolve|log|instances|stop|restart

Agent runtime (what a pane calls on itself, every turn)
  whoami [target] [--validate] | cold-start [--inject] | seat init|now|assign|mark|task|remind
  agent [target]              scoped can/cannot for this pane (profile role)
  agent context [roles|init]  registered read_first/files; init scaffolds .sm + validates
  func <id> <args...>         attached external (funcs: in mesh.config.yaml)
  contexts [--json] | peek | pane-meta | ppa
  switch | handoff | set | tag <target|self> <id|--auto> | title | status
  night on|off|status | continue <slot|all>   (manager + night on)
  slot-advice <slot> [--send] [note...]   (manager; worktree/DB/Redis heuristics)
  prompt | remind | flush

Coordination / comms (pane to pane)
  assign <target> <text...>     FOCUS NOW + TASK + peer SENT (do not hand-edit FOCUS)
  peer <target> <msg...>        FYI/ACK only — work goes through assign
  to-slot | to-mini <msg...>    enqueue (daemon injects) — to-master retired, use room say
  secretary start|dispatch|collect|status|watch …
  mini list|spawn|prompt|done|dispatch-all
  checkback start|list|cancel|cancel-all|reset|ack  (alias: patience)
  coord expect <target> <hub> <snippet...>   arm coord-expect on manager (verify + re-assign)
  room | chat | index | proxy | providers | manager | stack | profile show
  notify <session> <check> [--url URL]   desktop toast (seat from TMUX pane)
  notify yesno <title> <body> [--target secretary]   Yes/No links -> peer (notify-act)
  preview <file...> [--set days] [--notify]   publish markdown to mdview.io
  launch [--now] [targets…]

  --profile <dir|yaml>   override config (default: .sm/ walk-up or bundled profile)
`);
}

async function main(): Promise<void> {
  const { maybePrintVersionNudge } = await import("./ui/version-nudge.js");
  maybePrintVersionNudge();

  const { profile: profileArg, rest } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...tail] = rest;

  if (!cmd || (cmd.startsWith("-") && cmd !== "-h" && cmd !== "--help")) {
    const json = rest.includes("--json");
    if (!profileArg && !findDotSmConfig()) {
      const { printDiscoveryReport } = await import("./report/discovery-report.js");
      const report = await printDiscoveryReport({ json });
      process.exit(report.ok ? 0 : 1);
    }
    const loaded = meshLoaded(profileArg);
    const { printStatusReport } = await import("./report/status-report.js");
    const verbose = rest.includes("--verbose") || rest.includes("-v");
    const report = await printStatusReport(loaded, { json, verbose });
    process.exit(report.ok ? 0 : 1);
  }

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    try {
      usage(profileArg ? meshLoaded(profileArg) : undefined);
    } catch {
      usage();
    }
    return;
  }

  if (cmd === "update") {
    const { runUpdate } = await import("./setup/update.js");
    const { isNpxEphemeralInstall } = await import("./ui/version-nudge.js");
    const dryRun = rest.includes("--dry-run");
    const migrate = rest.includes("--migrate");
    const noRestartInbox = rest.includes("--no-restart-inbox");
    const r = runUpdate({ profileArg, dryRun, migrate });
    console.log(`OK: update dryRun=${dryRun} migrate=${migrate}`);
    console.log(`  package: ${r.packageVersion}${r.previousVersion ? ` (was ${r.previousVersion})` : ""}`);
    console.log(`  paths: ${r.pathsManifest}`);
    for (const line of r.refreshed) console.log(`  refreshed: ${line}`);
    for (const line of r.skipped) console.log(`  skipped (unchanged): ${line}`);
    if (r.migrate) {
      for (const line of r.migrate.copied) console.log(`  migrate copied: ${line}`);
      for (const line of r.migrate.skipped) console.log(`  migrate skipped: ${line}`);
    }
    if (isNpxEphemeralInstall()) {
      console.log(
        "  note: npx cache CLI — profile vendor updated only; npm package is re-fetched each npx run",
      );
    }
    if (!dryRun && !noRestartInbox) {
      const loaded = meshLoaded(profileArg);
      if (meshInboxEverConfigured(loaded)) {
        restartMeshInbox(loaded);
        console.log(`OK: inbox restarted on :${meshInboxPort(loaded)} session=${loaded.sessionName}`);
      } else {
        console.log("  inbox: skip restart (no inbox for this profile yet)");
      }
    } else if (noRestartInbox) {
      console.log("  inbox: skip restart (--no-restart-inbox)");
    }
    return;
  }

  if (cmd === "migrate-runtime") {
    const { runMigrateRuntime } = await import("./setup/migrate-runtime.js");
    const dryRun = rest.includes("--dry-run");
    const noSeats = rest.includes("--no-seats");
    const r = runMigrateRuntime({ profileArg, dryRun, seats: !noSeats });
    console.log(`OK: migrate-runtime dryRun=${dryRun}`);
    for (const line of r.copied) console.log(`  copied: ${line}`);
    for (const line of r.skipped) console.log(`  skipped: ${line}`);
    for (const line of r.notes) console.log(`  note: ${line}`);
    return;
  }

  if (cmd === "start") {
    let startProfileArg = profileArg;
    if (!profileArg && !findDotSmConfig()) {
      const r = runInit({});
      console.log(`OK: init ${r.smDir}`);
      startProfileArg = r.configPath;
    }
    const loaded = meshLoaded(startProfileArg);
    try {
      const { upsertGlobalSession } = await import("@seat-mesh/core");
      await upsertGlobalSession(loaded);
    } catch {
      /* non-fatal */
    }
    sessionUp(loaded);
    console.log(`OK: session '${loaded.sessionName}' up`);
    printMeshInboxStatus(loaded);
    sessionAttach(loaded);
    return;
  }

  if (cmd === "init") {
    const force = rest.includes("--force");
    const seatsIdx = rest.indexOf("--seats-root");
    const seatsRoot =
      seatsIdx >= 0 && rest[seatsIdx + 1] ? rest[seatsIdx + 1] : undefined;
    const nameIdx = rest.indexOf("--name");
    const name = nameIdx >= 0 && rest[nameIdx + 1] ? rest[nameIdx + 1] : undefined;
    const r = runInit({ force, seatsRoot, name });
    console.log(`OK: init ${r.smDir}`);
    console.log(`  config: ${r.configPath}`);
    console.log(`  created: ${r.created.length} file(s)`);
    if (r.skipped.length) console.log(`  skipped (exists): ${r.skipped.length}`);
    try {
      const { upsertGlobalSession } = await import("@seat-mesh/core");
      await upsertGlobalSession(meshLoaded(r.configPath));
    } catch {
      /* non-fatal */
    }
    console.log("  next: npx seatmesh session up  (or ./sm.sh if wired)");
    return;
  }

  if (cmd === "sessions") {
    const { runSessionsCommand } = await import("./commands/sessions-cli.js");
    process.exit(await runSessionsCommand(sub, tail, profileArg));
  }

  if (cmd === "profile" && sub === "show") {
    const loaded = meshLoaded(profileArg);
    const paths = profilePaths(loaded);
    console.log(`name=${loaded.profile.name}`);
    console.log(`path=${loaded.profilePath}`);
    console.log(`workspace=${loaded.workspace}`);
    console.log(`workspace_id=${loaded.workspaceId}`);
    console.log(`session_name=${loaded.sessionName}`);
    console.log(`daemon_port=${paths.daemonPort}`);
    console.log(`data_root=${paths.dataRoot}`);
    console.log(`daemon_dir=${paths.daemonDir}`);
    console.log(`seats_root=${paths.seatsRoot}`);
    console.log(`roles_dir=${paths.rolesDir}`);
    return;
  }

  if (cmd === "session") {
    const loaded = meshLoaded(profileArg);
    const touchRegistry = async () => {
      try {
        const { upsertGlobalSession } = await import("@seat-mesh/core");
        await upsertGlobalSession(loaded);
      } catch {
        /* non-fatal */
      }
    };
    if (sub === "up") {
      sessionUp(loaded);
      await touchRegistry();
      console.log(`OK: session '${loaded.sessionName}' created`);
      printMeshInboxStatus(loaded);
      return;
    }
    if (sub === "attach" || !sub) {
      await touchRegistry();
      sessionAttach(loaded);
      return;
    }
    if (sub === "status") {
      sessionStatus(loaded);
      return;
    }
    console.error("usage: session attach|up|status");
    process.exit(2);
  }

  if (cmd === "verify") {
    const loaded = meshLoaded(profileArg);
    ensureMeshInbox(loaded, { quiet: true });
    const layoutOk = printVerify(verifyMeshSession(loaded));
    const inboxOk = printMeshInboxStatus(loaded);
    process.exit(layoutOk && inboxOk ? 0 : 1);
  }

  if (cmd === "reload") {
    const loaded = meshLoaded(profileArg);
    const layout = rest.includes("--layout");
    reloadMesh(loaded, { layout });
    console.log(
      layout
        ? `OK: reload + relayout session ${loaded.sessionName}`
        : `OK: reload (build + labels) session ${loaded.sessionName}`,
    );
    printMeshInboxStatus(loaded);
    return;
  }

  if (cmd === "realign" || (cmd === "layout" && sub === "realign")) {
    const loaded = meshLoaded(profileArg);
    try {
      const r = realignAllLayouts(loaded);
      const fmt = (v: boolean | "skip") =>
        v === "skip" ? "skip" : v ? "applied" : "already-aligned";
      console.log(
        `OK: realign base=${fmt(r.base)} workers=${fmt(r.workers)} minis=${fmt(r.minis)} secretaryWidthPct=${loaded.profile.layout?.base.secretaryWidthPct ?? 50}`,
      );
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "layout" && sub === "column") {
    const loaded = meshLoaded(profileArg);
    const action = tail[0];
    const args = tail.slice(1);
    if (action === "list" || !action) {
      for (const id of listBaseColumns(loaded)) console.log(id);
      return;
    }
    if (action === "add") {
      const id = args.find((a) => !a.startsWith("--"));
      if (!id) {
        console.error("usage: layout column add <id> [--cli <provider>] [--after <id>] [--co-typed]");
        process.exit(2);
      }
      const cliIdx = args.indexOf("--cli");
      const afterIdx = args.indexOf("--after");
      try {
        const result = addBaseColumn(loaded, id, {
          cli: cliIdx !== -1 ? args[cliIdx + 1] : undefined,
          after: afterIdx !== -1 ? args[afterIdx + 1] : undefined,
          coTyped: args.includes("--co-typed"),
        });
        console.log(`OK: column added ${result.id} -> [${result.columns.join(", ")}]`);
        console.log(
          "No role yaml or seats.dirs entry needed -- seat dir + FOCUS/TASKS/REMINDER auto-create on next up/reload.",
        );
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
      return;
    }
    if (action === "remove") {
      const id = args[0];
      if (!id) {
        console.error("usage: layout column remove <id>");
        process.exit(2);
      }
      try {
        const result = removeBaseColumn(loaded, id);
        console.log(`OK: column removed ${result.id} -> [${result.columns.join(", ")}]`);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
      return;
    }
    console.error("usage: layout column list|add|remove");
    process.exit(2);
  }

  if (cmd === "layout") {
    const loaded = meshLoaded(profileArg);
    const skipLeads = rest.includes("--no-leads");
    const force = rest.includes("--yes");
    const dryRun = rest.includes("--dry-run");
    const m = loaded.profile.layout?.minis;
    if (dryRun) {
      printRelayoutPlan(loaded);
      return;
    }
    requireCoordRole(loaded, "layout");
    submitPaneOp(
      loaded,
      "relayout",
      { skipMinisLeads: skipLeads, force },
      `layout ${m?.grid ?? "grid"}`,
      () => {
        assertRelayoutSafe(loaded, force);
        relayoutMeshSession(loaded, { skipMinisLeads: skipLeads, force });
        const reg = createRegistryForProfile(loaded.profile);
        const saved = saveMeshSession(loaded, reg);
        const grid = m?.grid ?? "4x2";
        const leadNote =
          skipLeads || !m
            ? ""
            : ` leads=[${Array.isArray(m.leads) ? m.leads.join(",") : "1,2"}]`;
        console.log(
          `OK: relayout ${loaded.sessionName} (workers 3x2, minis ${grid}${leadNote})`,
        );
        console.log(`OK: layout saved ${saved}`);
      },
    );
    return;
  }

  if (cmd === "ops") {
    const loaded = meshLoaded(profileArg);
    if (sub === "list" || !sub) {
      printPaneOpsList(loaded);
      return;
    }
    if (sub === "clear") {
      const n = clearPaneOpsQueue(loaded);
      if (n < 0) {
        console.error("pane-ops clear: inbox unavailable");
        process.exit(1);
      }
      console.log(`OK: pane-ops cleared ${n} open`);
      return;
    }
    console.error("usage: ops list|clear");
    process.exit(2);
  }

  if (cmd === "inbox") {
    const loaded = meshLoaded(profileArg);
    const flagArgs = inboxStatusArgv(sub, tail);
    const flags = parseInboxStatusFlags(flagArgs);
    const json = flags.json || rest.includes("--json");

    if (sub === "stop") {
      requireInboxLifecycleRole(loaded, "inbox stop");
      stopMeshInbox(loaded);
      return;
    }
    if (sub === "restart") {
      requireInboxLifecycleRole(loaded, "inbox restart");
      restartMeshInbox(loaded);
      return;
    }
    if (sub === "start") {
      requireInboxLifecycleRole(loaded, "inbox start");
      startMeshInbox(loaded);
      return;
    }
    if (sub === "log") {
      const logArgs = tail.filter(Boolean) as string[];
      const follow = logArgs.includes("-f");
      const tailIdx = logArgs.indexOf("tail");
      let lines = 50;
      if (tailIdx >= 0 && logArgs[tailIdx + 1] && /^\d+$/.test(logArgs[tailIdx + 1]!)) {
        lines = Number(logArgs[tailIdx + 1]);
      } else {
        const num = logArgs.find((a) => /^\d+$/.test(a));
        if (num) lines = Number(num);
      }
      process.exit(tailInboxLog(loaded, { lines, follow }) ? 0 : 1);
    }
    if (sub === "instances") {
      listInboxInstances(loaded);
      return;
    }
    if (sub === "list" || sub === "all") {
      const rows = listInbox(loaded, { all: sub === "all", json });
      process.exit(rows ? 0 : 1);
    }
    if (sub === "resolve" || sub === "read") {
      const idArg = tail[0];
      try {
        const result = resolveInbox(loaded, {
          all: !idArg || idArg === "all",
          id: idArg && idArg !== "all" ? idArg : undefined,
          json,
        });
        process.exit(result ? 0 : 1);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(2);
      }
    }
    // status (default): optional --wait / --meta; else auto-start + one-line status
    if (flags.waitSec != null) {
      process.exit(
        waitForMeshInbox(loaded, flags.waitSec, { json, meta: flags.meta }) ? 0 : 1,
      );
    }
    if (flags.meta) {
      printInboxMeta(loaded, { json });
      process.exit(0);
    }
    ensureMeshInbox(loaded, { quiet: true });
    const ok = printMeshInboxStatus(loaded, { json });
    process.exit(ok ? 0 : 1);
  }

  if (cmd === "to-master") {
    // FRAMEWORK-QUEUE #1 (AGENT-FUNC-GUARDS.md): to-master retired — chat-first comms.
    console.error('DEPRECATED: use ./sm.sh room say [-r managers] "DONE|BLOCKED|…"');
    process.exit(2);
  }

  if (cmd === "to-slot") {
    const loaded = meshLoaded(profileArg);
    const dest = sub;
    const msg = tail.join(" ").trim();
    try {
      runToSlot(loaded, dest ?? "", msg);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "to-mini") {
    const loaded = meshLoaded(profileArg);
    const mid = sub;
    const msg = tail.join(" ").trim();
    try {
      runToMini(loaded, mid ?? "", msg);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "assign") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "assign");
    const target = sub;
    const text = tail.join(" ").trim();
    if (!target || !text) {
      console.error("usage: assign <column-id|slot-N|mini-N> <text...>");
      process.exit(2);
    }
    try {
      runSeatCommand(loaded, ["assign", target, ...tail]);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "peer") {
    const loaded = meshLoaded(profileArg);
    let direct = false;
    const args: string[] = [];
    for (const a of [sub, ...tail].filter((x): x is string => x != null && x !== "")) {
      if (a === "--direct" || a === "--now") direct = true;
      else args.push(a);
    }
    if (args[0] === "verify") {
      requireCoordRole(loaded, "peer verify");
      const mgrs = managerColumnIds(loaded.profile.layout);
      const target = args[1] ?? mgrs[1] ?? mgrs[0] ?? "manager";
      const reg = createRegistryForProfile(loaded.profile);
      const r = runPeerVerify(loaded, reg, target);
      printPeerVerify(r);
      process.exit(r.pass ? 0 : 1);
    }
    const [target, ...textParts] = args;
    const rawMsg = textParts.join(" ").trim();
    if (!target || !rawMsg) {
      console.error(
        "usage: peer verify [target] | peer [--direct] <manager|secretary|slot-N|mini-N|@alias:seat|pane> <msg...>",
      );
      process.exit(2);
    }
    try {
      const remote = parseRemotePeerTarget(target);
      if (remote) {
        runRemotePeer(loaded, remote.alias, remote.seat, rawMsg);
        return;
      }
      // Workers + minis: universal peer (to-slot/to-mini/enqueue). Coords keep manager stamp.
      try {
        runPeer(loaded, target, rawMsg);
        return;
      } catch (e) {
        if ((e as Error).message !== "__peer_coord__") throw e;
      }
      requireCoordRole(loaded, "peer");
      if (direct) {
        const reg = createRegistryForProfile(loaded.profile);
        const { paneId, providerId, token, via } = injectPromptDirect(
          loaded,
          reg,
          target,
          rawMsg,
          { manager: true },
        );
        console.log(
          `SENT: peer --direct -> ${target} pane=${paneId} provider=${providerId} token=${token ?? "-"} via=${via ?? "direct"}`,
        );
      } else {
        const coord = isCoordKind(
          target.replace(/^slot-/, "").toLowerCase(),
          loaded.profile.layout?.base.kinds,
        );
        const { paneId, targetLabel, token, via } = enqueuePrompt(loaded, target, rawMsg, {
          manager: true,
          armCheckback: !coord,
        });
        const line =
          via === "queued"
            ? `QUEUED: peer -> ${targetLabel} pane=${paneId} token=${token ?? "-"} (inbox inject when idle)`
            : `SENT: peer -> ${targetLabel} pane=${paneId} token=${token ?? "-"} via=${via ?? "pane-row"}`;
        console.log(line);
      }
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "mini") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    if (sub === "list" || !sub) {
      printMiniList(loaded);
      return;
    }
    if (sub === "dispatch-all") {
      requireCoordRole(loaded, "mini dispatch-all");
      miniSpawnAll(loaded, reg);
      return;
    }
    if (sub === "spawn") {
      requireCoordRole(loaded, "mini spawn");
      const args = tail.filter((a) => a !== "--");
      let role = "helper";
      const ids: number[] = [];
      const taskParts: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--role" && args[i + 1]) {
          role = args[++i];
          continue;
        }
        if (a === "all") {
          for (let n = 1; n <= loaded.profile.session.miniMax; n++) ids.push(n);
          continue;
        }
        const m = a.match(/^mini-?(\d+)$/);
        if (m) {
          ids.push(Number(m[1]));
          continue;
        }
        if (/^\d+$/.test(a)) {
          ids.push(Number(a));
          continue;
        }
        taskParts.push(a);
      }
      const task = taskParts.join(" ").trim();
      if (!ids.length || !task) {
        console.error("usage: mini spawn <1-8|all|mini-N> [--role helper] <task...>");
        process.exit(2);
      }
      for (const n of ids) {
        submitPaneOp(
          loaded,
          "mini-spawn",
          { n, role, task, viaSecretary: false },
          `mini spawn ${n} role=${role}`,
          () => miniSpawn(loaded, reg, n, role, task, { viaSecretary: false }),
        );
      }
      return;
    }
    if (sub === "prompt") {
      requireCoordRole(loaded, "mini prompt");
      const n = Number(tail[0]);
      const text = tail.slice(1).join(" ");
      if (!n || !text) {
        console.error("usage: mini prompt <N> <text...>");
        process.exit(2);
      }
      miniPrompt(loaded, reg, n, text);
      return;
    }
    if (sub === "done") {
      const n = Number(tail[0]);
      const report = tail.slice(1).join(" ");
      if (!n || !report) {
        console.error("usage: mini done <N> PASS|FAIL: <evidence>");
        process.exit(2);
      }
      miniDone(loaded, n, report);
      return;
    }
    console.error("usage: mini list|spawn|prompt|done|dispatch-all");
    process.exit(2);
  }

  if (cmd === "secretary") {
    const loaded = meshLoaded(profileArg);
    const secretaryReadOnly =
      !sub ||
      sub === "status" ||
      (sub === "watch" && (tail[0] ?? "status").toLowerCase() === "status") ||
      (sub === "supervise" && (tail[0] ?? "status").toLowerCase() === "status");
    if (!secretaryReadOnly) {
      requireCoordRole(loaded, `secretary ${sub ?? ""}`.trim());
    }
    if (sub === "start") {
      secretaryLaunch(loaded);
      return;
    }
    if (sub === "restart" || sub === "switch") {
      const reg = createRegistryForProfile(loaded.profile);
      const keepResume =
        rest.includes("--keep-resume") ||
        tail.includes("--keep-resume") ||
        rest.includes("--no-fresh") ||
        tail.includes("--no-fresh");
      const fresh = keepResume ? false : true;
      const typeFlagIdx = tail.indexOf("--type");
      const cliTypes = new Set([
        "agent",
        "claude",
        "kiro",
        "opencode",
        "cursor-agent",
        "oc",
        "cursor",
        "cc",
      ]);
      let typeArg = typeFlagIdx >= 0 ? tail[typeFlagIdx + 1] : undefined;
      if (!typeArg) {
        const positional = tail.find(
          (t) =>
            !t.startsWith("--") &&
            t !== "--fresh" &&
            t !== "--keep-resume" &&
            t !== "--no-fresh",
        );
        if (positional && cliTypes.has(positional)) {
          typeArg =
            positional === "oc"
              ? "opencode"
              : positional === "cursor"
                ? "agent"
                : positional === "cc"
                  ? "claude"
                  : positional;
        }
      }
      if (sub === "switch") {
        if (!typeArg) {
          console.error(
            "usage: secretary switch claude|agent|opencode|kiro [--keep-resume]  (alias: switch secretary <type>)",
          );
          process.exit(2);
        }
        runSwitch(loaded, reg, "secretary", typeArg, { fresh });
        saveMeshSession(loaded, reg);
        return;
      }
      secretaryRestart(loaded, reg, typeArg, fresh);
      saveMeshSession(loaded, reg);
      return;
    }
    if (sub === "dispatch") {
      const reg = createRegistryForProfile(loaded.profile);
      secretaryDispatch(loaded, reg);
      return;
    }
    if (sub === "collect") {
      const reg = createRegistryForProfile(loaded.profile);
      const send = rest.includes("--send");
      const nudge = rest.includes("--nudge");
      const digest = secretaryCollect(loaded, reg, { sendManager: send, nudgeOpen: nudge });
      process.exit(digest.allDone ? 0 : 1);
    }
    if (sub === "status" || !sub) {
      secretaryStatus(loaded);
      return;
    }
    if (sub === "watch") {
      const action = (tail[0] ?? "status").toLowerCase();
      if (action === "on") {
        secretaryMeshWatch(loaded, "on", tail[1] ?? "5m");
        return;
      }
      if (action === "off") {
        secretaryMeshWatch(loaded, "off");
        return;
      }
      secretaryMeshWatch(loaded, "status");
      return;
    }
    if (sub === "supervise") {
      const reg = createRegistryForProfile(loaded.profile);
      const action = (tail[0] ?? "status").toLowerCase();
      if (action === "on") {
        secretarySupervise(loaded, reg, "on", tail[1] ?? "10m");
        return;
      }
      if (action === "off") {
        secretarySupervise(loaded, reg, "off");
        return;
      }
      if (action === "run") {
        const flags = tail.slice(1);
        secretarySupervise(loaded, reg, "run", undefined, {
          dryRun: flags.includes("--dry-run"),
          postStatus: flags.includes("--status"),
        });
        return;
      }
      secretarySupervise(loaded, reg, "status");
      return;
    }
    console.error(
      "usage: secretary start|switch|restart [claude|cc|agent|cursor|oc|opencode|kiro] [--fresh]|status|supervise on [10m]|supervise run [--status|--dry-run]|supervise off|watch on [5m]|watch off",
    );
    process.exit(2);
  }

  if (cmd === "peek") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const target = sub ?? "here";
    const modeRaw = (tail[0] ?? "status").toLowerCase();
    const mode = modeRaw === "full" ? "full" : "status";
    try {
      runPeek(loaded, reg, target, mode);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "pane-meta") {
    const loaded = meshLoaded(profileArg);
    try {
      runPaneMeta(loaded, [sub, ...tail].filter((a): a is string => Boolean(a)));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "ppa") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const ppaSub = sub ?? "perf-index";
    if (ppaSub !== "perf-index" && ppaSub !== "index") {
      console.error("usage: ppa [perf-index]");
      process.exit(2);
    }
    try {
      runPpa(loaded, reg);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "contexts" || cmd === "seats") {
    const loaded = meshLoaded(profileArg);
    printSeatContexts(loaded, rest.includes("--json"));
    return;
  }

  if (cmd === "cold-start" || cmd === "coldstart") {
    const loaded = meshLoaded(profileArg);
    const inject = rest.includes("--inject");
    const force = rest.includes("--force");
    const targetArg = sub && sub !== "--inject" ? sub : undefined;
    const w = runWhoami(loaded, targetArg);
    const miniMatch = targetArg?.match(/^mini-(\d+)$/);
    const mini = miniMatch?.[1] ?? (w.role === "manager-mini" ? targetArg : undefined);
    const target = targetArg ?? "here";
    if (inject) {
      const r = enqueueColdStart(loaded, target, {
        mini: mini ?? null,
        force,
      });
      console.log(
        r.skipped
          ? `OK: cold-start skipped (idempotent fingerprint=${r.fingerprint}) -> ${target}`
          : `OK: cold-start enqueued fingerprint=${r.fingerprint} -> ${target}`,
      );
      return;
    }
    console.log(buildFullColdStartBrief(loaded, w, { mini: mini ?? null }));
    return;
  }

  if (cmd === "seat") {
    const loaded = meshLoaded(profileArg);
    if (sub === "init" || !sub) {
      const { created, ensured } = runSeatInit(loaded);
      console.log(
        `OK: seat init (ensured=${ensured.length} created=${created.length} — idempotent, never overwrites FOCUS/TASKS)`,
      );
      for (const p of created.slice(0, 12)) console.log(`  + ${p}`);
      if (created.length > 12) console.log(`  ... +${created.length - 12} more`);
      return;
    }
    runSeatCommand(loaded, [sub, ...tail]);
    return;
  }

  if (cmd === "test") {
    const loaded = meshLoaded(profileArg);
    ensureMeshInbox(loaded, { quiet: true });
    const results = await runMeshSmoke(loaded);
    const ok = printSmokeResults(results);
    process.exit(ok ? 0 : 1);
  }

  if (cmd === "labels") {
    const loaded = meshLoaded(profileArg);
    const session = liveMeshSession(loaded);
    const layout = loaded.profile.layout;
    if (!layout) {
      console.error("profile missing layout");
      process.exit(1);
    }
    labelMeshSession(loaded, session);
    applyMeshSessionBorders(session, [
      layout.nvim.window,
      layout.base.window,
      layout.workers.window,
      layout.minis.window,
    ]);
    console.log(`OK: labels + borders on session ${session}`);
    return;
  }

  if (cmd === "launch") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "launch");
    const rawArgs = [sub, ...tail].filter(
      (a): a is string => Boolean(a) && a !== "--",
    );
    const launchNow = rawArgs.includes("--now");
    const targets = rawArgs.filter((a) => a !== "--now");
    const label = targets.length ? targets.join(",") : "all";
    const runLaunch = () => {
      const results = launchSession(loaded, {
        targets: targets.length ? targets : undefined,
      });
      printLaunchResults(results);
      if (results.some((r) => r.status === "failed")) process.exit(1);
    };
    if (launchNow) {
      runLaunch();
      return;
    }
    submitPaneOp(
      loaded,
      "launch",
      { targets: targets.length ? targets : undefined },
      `launch ${label}`,
      runLaunch,
    );
    return;
  }

  if (cmd === "prompt") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "prompt");
    let manager = false;
    const args: string[] = [];
    for (const a of [sub, ...tail].filter((x): x is string => x != null && x !== "")) {
      if (a === "--manager" || a === "-m") manager = true;
      else args.push(a);
    }
    const [target, ...textParts] = args;
    if (!target || !textParts.length) {
      console.error("usage: prompt [--manager] <target> <text...>");
      process.exit(2);
    }
    const text = textParts.join(" ");
    const { paneId, targetLabel, token, via } = enqueuePrompt(loaded, target, text, {
      manager,
    });
    console.log(
      `SENT: prompt -> ${targetLabel} pane=${paneId} token=${token ?? "-"} via=${via ?? "pane-row"}`,
    );
    return;
  }

  if (cmd === "remind") {
    const loaded = meshLoaded(profileArg);
    const workerCount = loaded.profile.session.workerCount;
    const [target, ...noteParts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target) {
      console.error(`usage: remind <slot|all> [note...]   (manager-only, workers 1-${workerCount})`);
      process.exit(2);
    }
    const parsed = /^(?:slot-)?(\d+)$/.exec(target);
    if (target !== "all" && !parsed) {
      console.error(`usage: remind <slot|all> [note...]   (manager-only, workers 1-${workerCount})`);
      process.exit(2);
    }
    if (parsed) {
      const n = Number(parsed[1]);
      if (n < 1 || n > workerCount) {
        console.error(
          `refused: remind targets worker slots 1-${workerCount} only (got ${n})`,
        );
        process.exit(2);
      }
    }
    const results = runRemind(loaded, target, {
      note: noteParts.length ? noteParts.join(" ") : undefined,
    });
    printRemindResults(results);
    return;
  }

  if (cmd === "night") {
    const loaded = meshLoaded(profileArg);
    if ((sub ?? "status") !== "status") {
      requireCoordRole(loaded, "night");
    }
    try {
      runNight(loaded, sub ?? "status");
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "slot-advice") {
    const loaded = meshLoaded(profileArg);
    const args = [sub, ...tail].filter(Boolean) as string[];
    if (!args.length) {
      console.error("usage: slot-advice <slot|slot-N> [--send] [note...]");
      process.exit(2);
    }
    const send = args.includes("--send");
    const noteParts = args.filter((a) => a !== "--send");
    const target = noteParts[0];
    const note = noteParts.slice(1).join(" ") || undefined;
    if (!target) {
      console.error("usage: slot-advice <slot|slot-N> [--send] [note...]");
      process.exit(2);
    }
    try {
      if (send) requireCoordRole(loaded, "slot-advice --send");
      runSlotAdvice(loaded, target, { send, note });
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "continue") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "continue");
    const [target, ...noteParts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target) {
      console.error("usage: continue <slot|all> [note...]   (manager-only, requires night on)");
      process.exit(2);
    }
    try {
      const results = runContinue(loaded, target, noteParts.join(" ") || undefined);
      printContinueResults(results);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "flush") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "flush");
    const reg = createRegistryForProfile(loaded.profile);
    const target = sub ?? "all";
    if (!sub) {
      console.error("usage: flush <slot|all|manager|mini-N>");
      process.exit(2);
    }
    const results = runFlush(loaded, reg, target);
    printFlushResults(results);
    return;
  }

  if (cmd === "switch" || cmd === "handoff") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, cmd);
    const reg = createRegistryForProfile(loaded.profile);
    const args = [sub, ...tail].filter(Boolean);
    if (args.length < 2) {
      console.error(
        "usage: switch <target> <agent|cursor|claude|cc|kiro|oc|opencode|empty> [--keep-resume] [--resume ID] [--queue] [reason...]",
      );
      console.error(
        "  targets: secretary|sec, manager|mgr, slot-N, mini-N, here|self (this pane's role)",
      );
      process.exit(2);
    }
    const target = args[0]!;
    const newType = args[1]!;
    let fresh: boolean | undefined;
    let queue = false;
    let resumeId: string | undefined;
    const reasonParts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const a = args[i]!;
      if (a === "--fresh") fresh = true;
      else if (a === "--keep-resume" || a === "--no-fresh") fresh = false;
      else if (a === "--queue") queue = true;
      else if (a === "--resume" && args[i + 1]) resumeId = args[++i];
      else if (a.startsWith("--resume=")) resumeId = a.slice("--resume=".length);
      else reasonParts.push(a);
    }
    const reason = reasonParts.join(" ") || undefined;
    const run = () =>
      runSwitch(loaded, reg, target, newType, {
        fresh,
        resumeId,
        reason,
      });
    if (queue) {
      submitPaneOp(
        loaded,
        "switch",
        { target, newType, fresh, resumeId, reason },
        `switch ${target} -> ${newType}`,
        run,
      );
    } else {
      run();
      saveMeshSession(loaded, reg);
    }
    return;
  }

  if (cmd === "report") {
    const loaded = meshLoaded(profileArg);
    const { printStatusReport } = await import("./report/status-report.js");
    const report = await printStatusReport(loaded, {
      json: rest.includes("--json"),
      verbose: rest.includes("--verbose") || rest.includes("-v"),
    });
    process.exit(report.ok ? 0 : 1);
  }

  if (cmd === "set") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "set");
    const reg = createRegistryForProfile(loaded.profile);
    const target = sub;
    const typeRaw = tail[0];
    if (!target || !typeRaw) {
      console.error("usage: set <target> <agent|kiro|claude|opencode|empty>");
      process.exit(2);
    }
    runSet(loaded, reg, target, typeRaw);
    return;
  }

  if (cmd === "tag") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    const auto = args.includes("--auto");
    const parts = args.filter((a) => a !== "--auto");
    const target = parts[0];
    const resumeId = parts[1];
    if (!target || (!auto && !resumeId)) {
      console.error("usage: tag <target|self> <resume_id|--auto>");
      process.exit(2);
    }
    try {
      runTag(loaded, reg, target, resumeId ?? "--auto", { auto });
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "title") {
    const loaded = meshLoaded(profileArg);
    const [target, ...parts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target || !parts.length) {
      console.error("usage: title <target> <text...>");
      process.exit(2);
    }
    setPaneTitle(loaded, target, parts.join(" "));
    console.log(`OK: title ${target}`);
    return;
  }

  if (cmd === "status") {
    const loaded = meshLoaded(profileArg);
    const [target, ...parts] = [sub, ...tail].filter(Boolean) as string[];
    if (!target || !parts.length) {
      console.error("usage: status <target> <text...>");
      process.exit(2);
    }
    setPaneStatus(loaded, target, parts.join(" "));
    console.log(`OK: status ${target}`);
    return;
  }

  if (cmd === "agent") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    if (sub === "apply") {
      const { bundle, opts } = parseAgentApplyArgs(tail);
      applyAgentContractBundle(loaded, reg, bundle, opts);
      return;
    }
    if (sub === "preflight") {
      const { bundle, opts } = parseAgentApplyArgs(tail);
      applyAgentContractBundle(loaded, reg, bundle, { ...opts, preflight: true, dryRun: true });
      return;
    }
    if (sub === "context") {
      if (tail[0] === "init") {
        const code = runAgentContextInit(loaded, { coldStartInject: tail.includes("--inject") });
        process.exit(code);
      }
      if (tail[0] === "roles") {
        process.exit(printAgentContextAllRoles(loaded));
      }
      const targetArg = tail.find((a) => !a.startsWith("-"));
      process.exit(printAgentContext(loaded, targetArg));
    }
    const w = runWhoami(loaded, sub || tail[0]);
    printAgentCard(w);
    return;
  }

  if (cmd === "func") {
    // AGENT-FUNC-GUARDS.md func registry: attached external, guarded by profile
    // external.default (global) + role yaml funcs allow/deny (per-role, ROLE-YAML.md).
    const loaded = meshLoaded(profileArg);
    const id = sub;
    if (!id) {
      console.error("usage: func <id> <args...>");
      process.exit(2);
    }
    const entry = loaded.profile.funcs?.[id];
    if (!entry) {
      console.error(`func not found: ${id} (check funcs: in mesh.config.yaml)`);
      process.exit(2);
    }
    if (loaded.profile.external.default === "deny") {
      console.error(`UNAUTHORIZED: func ${id} denied (external.default=deny)`);
      console.error("hint: ./sm.sh agent");
      process.exit(2);
    }
    try {
      const w = runWhoami(loaded, "here");
      const kind = roleKindFromWhoami(w.role);
      const paths = profilePaths(loaded);
      const index = loadRoleIndex(paths.rolesDir, kind);
      if (!roleAllows(index.funcs, id)) {
        console.error(`UNAUTHORIZED: func ${id} denied for role=${kind}`);
        console.error("hint: ./sm.sh agent");
        process.exit(2);
      }
    } catch {
      // No role yaml for this pane/kind yet — fall through to the global gate only.
    }
    const r = spawnSync(entry.command, tail, {
      stdio: "inherit",
      shell: true,
      cwd: loaded.workspace,
    });
    process.exit(r.status ?? 1);
  }

  if (cmd === "coord") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "coord");
    const reg = createRegistryForProfile(loaded.profile);
    coordCommand(loaded, reg, sub ?? "", tail);
    return;
  }

  if (cmd === "balance") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const action = (sub ?? "status").toLowerCase();
    if (action !== "status") {
      requireCoordRole(loaded, `balance ${action}`);
    }
    if (action === "on") {
      balanceLeadCommand(loaded, reg, "on", tail[0] ?? "10m");
      return;
    }
    if (action === "off") {
      balanceLeadCommand(loaded, reg, "off");
      return;
    }
    if (action === "run") {
      balanceLeadCommand(loaded, reg, "run", undefined, {
        dryRun: rest.includes("--dry-run"),
      });
      return;
    }
    balanceLeadCommand(loaded, reg, "status");
    return;
  }

  if (cmd === "whoami" || cmd === "where") {
    if (cmd === "where") {
      console.error("note: where is deprecated — use ./sm.sh whoami");
    }
    const loaded = meshLoaded(profileArg);
    const json = rest.includes("--json");
    const validate = rest.includes("--validate");
    const targetArg = [sub, ...tail].find((a) => a !== "--json" && a !== "--validate") as
      | string
      | undefined;
    if (json) {
      const payload = validate
        ? whoamiJsonWithValidate(loaded, targetArg)
        : whoamiJson(loaded, targetArg);
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printWhoami(loaded, targetArg);
      if (validate) {
        const result = validateWhoamiRoleIndex(loaded, targetArg);
        if (!result.ok) {
          console.error(
            `FAIL: role=${result.kind} missing paths:\n${result.missing.map((m) => `  - ${m}`).join("\n")}`,
          );
          process.exit(1);
        }
        console.log(`OK: role=${result.kind} role-index paths exist`);
      }
    }
    return;
  }

  if (cmd === "index") {
    const loaded = meshLoaded(profileArg);
    const paths = profilePaths(loaded);
    if (sub === "show") {
      let role = "worker";
      for (let i = 0; i < tail.length; i++) {
        if (tail[i] === "--role" && tail[i + 1]) role = tail[++i];
      }
      const index = loadRoleIndex(paths.rolesDir, role);
      if (tail.includes("--json")) {
        console.log(JSON.stringify(index, null, 2));
      } else {
        console.log(renderRoleIndex(index));
      }
      return;
    }
    if (sub === "validate") {
      let role = "worker";
      for (let i = 0; i < tail.length; i++) {
        if (tail[i] === "--role" && tail[i + 1]) role = tail[++i];
      }
      const index = loadRoleIndex(paths.rolesDir, role);
      const result = validateRoleIndex(index, loaded.workspace);
      if (!result.ok) {
        console.error(`FAIL: missing paths:\n${result.missing.map((m) => `  - ${m}`).join("\n")}`);
        process.exit(1);
      }
      console.log(`OK: role=${role} paths exist under ${loaded.workspace}`);
      return;
    }
    console.error("usage: index show|validate");
    process.exit(2);
  }

  if (cmd === "proxy") {
    const loaded = meshLoaded(profileArg);
    const snap = await snapshotConnectivity(loaded.profile);
    if (sub === "status" || sub === "check" || !sub) {
      console.log(formatStatus(snap));
      if (sub === "check" && snap.pendingTriggers.length) process.exit(1);
      return;
    }
    if (sub === "reset") {
      const { spawnSync } = await import("node:child_process");
      const path = await import("node:path");
      const script = path.join(loaded.workspace, "scripts/oc-proxy-reset.sh");
      const r = spawnSync("bash", [script], {
        cwd: loaded.workspace,
        encoding: "utf8",
        stdio: "inherit",
      });
      process.exit(r.status ?? 1);
    }
    console.error("usage: proxy status|check|reset");
    process.exit(2);
  }

  if (cmd === "providers") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    if (sub === "list") {
      for (const p of reg.all()) console.log(p.id);
      return;
    }
    if (sub === "scan") {
      const session = tail[0] ?? liveMeshSession(loaded);
      const panes = listSessionPanes(session);
      if (!panes.length) {
        console.error(`no panes in session ${session} (tmux running?)`);
        process.exit(1);
      }
      for (const paneId of panes) {
        const snap = capturePaneSnapshot(paneId);
        if (!snap) continue;
        const prov = reg.detect(snap);
        const det = prov?.detect(snap);
        const state = prov?.composerState(snap) ?? { phase: "plain_shell" };
        const slot = snap.options.mesh_slot || "-";
        const ports = snap.options.mesh_ports || "-";
        console.log(
          `${paneId}\t${prov?.id ?? "?"}\t${det?.resumeId ?? "-"}\t${state.phase}${state.limitKind ? `:${state.limitKind}` : ""}\tslot=${slot}\tports=${ports}\t${snap.windowName}`,
        );
      }
      return;
    }
    console.error("usage: providers list|scan [session]");
    process.exit(2);
  }

  if (cmd === "manager") {
    const loaded = meshLoaded(profileArg);
    const w = runWhoami(loaded);
    const isManager = isManagerKind(w.role, loaded.profile.layout?.base.kinds);
    const label = isManager ? `yes: ${w.role}` : `no: role=${w.role}`;
    console.log(label);
    process.exit(isManager ? 0 : 1);
  }

  if (cmd === "base") {
    const loaded = meshLoaded(profileArg);
    if (sub === "ensure") {
      const session = liveMeshSession(loaded);
      const panes = ensureBaseLayout(loaded, session);
      labelMeshSession(loaded, session);
      console.log(`OK: base panes=${panes.length} columns=${loaded.profile.layout?.base.columns?.join("|") ?? "?"}`);
      return;
    }
    if (sub === "realign") {
      const session = liveMeshSession(loaded);
      const changed = realignBaseLayout(loaded, session);
      console.log(
        `OK: base realign ${changed ? "applied" : "already-aligned"} secretaryWidthPct=${loaded.profile.layout?.base.secretaryWidthPct ?? 50} columns=${loaded.profile.layout?.base.columns?.join("|") ?? "?"}`,
      );
      return;
    }
    console.error("usage: base ensure|realign");
    process.exit(2);
  }

  if (cmd === "stack" || cmd === "dc") {
    const loaded = meshLoaded(profileArg);
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    process.exit(runStackPassthrough(loaded, args));
  }

  if (cmd === "room" || cmd === "contract" || cmd === "chat") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch =
      cmd === "room"
        ? buildRoomCommands(getLoaded)
        : cmd === "contract"
          ? buildContractLockCommands(getLoaded)
          : buildChatCommands(getLoaded);
    if (!sub) {
      branch.outputHelp();
      return;
    }
    try {
      await branch.parseAsync([sub, ...tail], { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "save" || cmd === "auto") {
    const loaded = meshLoaded(profileArg);
    assertSaveAllowed(loaded);
    const reg = createRegistryForProfile(loaded.profile);
    const json = rest.includes("--json");
    const skipLabels = rest.includes("--no-labels");
    const { file, data } = saveMeshSessionDetailed(loaded, reg);
    if (!skipLabels) {
      console.log("Applying pane labels...");
      labelMeshSession(loaded);
    }
    if (json) {
      console.log(JSON.stringify({ file, agents: data }, null, 2));
    } else {
      console.log(`OK: saved ${file}`);
      console.log(formatSaveSummary(data, file));
    }
    return;
  }

  if (cmd === "checkback" || cmd === "patience") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildCheckbackCommands(getLoaded);
    if (!sub) {
      branch.outputHelp();
      return;
    }
    try {
      await branch.parseAsync([sub, ...tail], { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "notify") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildNotifyCommand(getLoaded);
    try {
      await branch.parseAsync(rest.slice(1), { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "preview") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildPreviewCommand(getLoaded);
    try {
      await branch.parseAsync(rest.slice(1), { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(2);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

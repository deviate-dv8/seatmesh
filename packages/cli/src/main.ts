#!/usr/bin/env node

import { findDotSmConfig } from "@seat-mesh/core";
import {
  loadProfile,
  profilePaths,
  loadRoleIndex,
  renderRoleIndex,
  validateRoleIndex,
  runStackPassthrough,
} from "@seat-mesh/core";
import { snapshotConnectivity, formatStatus } from "@seat-mesh/connectivity";
import { createRegistryForProfile } from "@seat-mesh/providers";
import {
  printWhoami,
  printAgentCard,
  runWhoami,
  capturePaneSnapshot,
  listSessionPanes,
  sessionAttach,
  sessionUp,
  sessionStatus,
  relayoutMeshSession,
  reloadMesh,
  ensureMeshInbox,
  startMeshInbox,
  stopMeshInbox,
  restartMeshInbox,
  printMeshInboxStatus,
  sendToMaster,
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
  runRemind,
  printRemindResults,
  verifyMeshSession,
  printVerify,
  labelMeshSession,
  liveMeshSession,
  ensureBaseLayout,
  applyMeshSessionBorders,
  runFlush,
  printFlushResults,
  runSwitch,
  setPaneTitle,
  setPaneStatus,
  printSeatContexts,
  runPeek,
  runPpa,
  runToSlot,
  runToMini,
  applyMeshState,
  saveMeshSession,
  submitPaneOp,
  clearPaneOpsQueue,
  printPaneOpsList,
  printRelayoutPlan,
  assertRelayoutSafe,
  buildColdStartBrief,
  buildFullColdStartBrief,
  enqueueColdStart,
  runSeatInit,
} from "@seat-mesh/tmux";
import { buildChatCommands } from "./chat-cli.js";
import { buildCheckbackCommands } from "./checkback-cli.js";
import { buildContractLockCommands } from "./contract-lock-cli.js";
import { buildRoomCommands } from "./room-cli.js";
import { runInit } from "./init.js";

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

  init [--force] [--seats-root PATH] [--name NAME]   create .sm/ dotdir
  sessions [pick|list|attach|forget|register] [--json]   global registry + TUI picker
  update [--dry-run] [--migrate]        refresh _vendor templates + paths.json
  report [--json]         full stack report (same as bare npx seatmesh)
  session attach|up|status
  verify              layout + labels health
  reload [--layout]   rebuild engine + labels (no session kill; --layout re-grids)
  layout [--no-leads] [--dry-run] [--yes]   workers + minis grid (queued)
  ops list|clear                pane-op queue (serial)
  save|auto                     scrape session -> mesh-agents.json (daemon also auto-scrapes every 10m)
  labels                        re-apply @mesh_* + border strip
  inbox [--json] | inbox stop|restart
  peer <target> <msg...>        manager -> any pane (one path; alias: prompt -m)
  to-master | to-slot | to-mini <msg...>    enqueue (daemon injects)
  secretary start|dispatch|collect|status|watch …
  mini list|spawn|prompt|done|dispatch-all
  checkback start|list|cancel|cancel-all  (alias: patience)
  test                          smoke: layout, providers, inbox, proxy
  launch [--now] [targets…]
  prompt | remind | flush
  contexts [--json] | peek | ppa
  switch | handoff | title | status
  agent [target]              scoped can/cannot for this pane (profile role)
  whoami [target] | cold-start [--inject] | seat init
  room | chat | index | proxy | providers | manager | stack | profile show

  --profile <dir|yaml>   override config (default: .sm/ walk-up or bundled profile)
`);
}

async function main(): Promise<void> {
  const { profile: profileArg, rest } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...tail] = rest;

  if (!cmd) {
    const json = rest.includes("--json");
    if (!profileArg && !findDotSmConfig()) {
      const { printDiscoveryReport } = await import("./discovery-report.js");
      const report = await printDiscoveryReport({ json });
      process.exit(report.ok ? 0 : 1);
    }
    const loaded = meshLoaded(profileArg);
    const { printStatusReport } = await import("./status-report.js");
    const report = await printStatusReport(loaded, { json });
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
    const { runUpdate } = await import("./update.js");
    const dryRun = rest.includes("--dry-run");
    const migrate = rest.includes("--migrate");
    const r = runUpdate({ profileArg, dryRun, migrate });
    console.log(`OK: update dryRun=${dryRun} migrate=${migrate}`);
    console.log(`  paths: ${r.pathsManifest}`);
    for (const line of r.refreshed) console.log(`  refreshed: ${line}`);
    for (const line of r.skipped) console.log(`  skipped (exists): ${line}`);
    if (r.migrate) {
      for (const line of r.migrate.copied) console.log(`  migrate copied: ${line}`);
      for (const line of r.migrate.skipped) console.log(`  migrate skipped: ${line}`);
    }
    return;
  }

  if (cmd === "migrate-runtime") {
    const { runMigrateRuntime } = await import("./migrate-runtime.js");
    const dryRun = rest.includes("--dry-run");
    const noSeats = rest.includes("--no-seats");
    const r = runMigrateRuntime({ profileArg, dryRun, seats: !noSeats });
    console.log(`OK: migrate-runtime dryRun=${dryRun}`);
    for (const line of r.copied) console.log(`  copied: ${line}`);
    for (const line of r.skipped) console.log(`  skipped: ${line}`);
    for (const line of r.notes) console.log(`  note: ${line}`);
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
    const { runSessionsCommand } = await import("./sessions-cli.js");
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
    const json = rest.includes("--json");
    if (sub === "stop") {
      stopMeshInbox(loaded);
      return;
    }
    if (sub === "restart") {
      restartMeshInbox(loaded);
      return;
    }
    if (sub === "start") {
      startMeshInbox(loaded);
      return;
    }
    // status (default): engine auto-starts, then one-line status
    ensureMeshInbox(loaded, { quiet: true });
    const ok = printMeshInboxStatus(loaded, { json });
    process.exit(ok ? 0 : 1);
  }

  if (cmd === "to-master") {
    const loaded = meshLoaded(profileArg);
    let from: string | undefined;
    let slot: string | undefined;
    const parts: string[] = [];
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--from" && args[i + 1]) from = args[++i];
      else if (a === "--slot" && args[i + 1]) slot = args[++i];
      else parts.push(a);
    }
    const msg = parts.join(" ").trim();
    if (!msg) {
      console.error("usage: to-master [--from <who>] [--slot <N|label>] <msg...>");
      process.exit(2);
    }
    const entry = sendToMaster(loaded, msg, { from, slot });
    if (!entry || entry.ok !== true) {
      console.error("FAIL: to-master enqueue (inbox down?) — run: ./sm.sh inbox");
      process.exit(1);
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
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

  if (cmd === "peer") {
    const loaded = meshLoaded(profileArg);
    const target = sub;
    const msg = tail.join(" ").trim();
    if (!target || !msg) {
      console.error("usage: peer <manager|secretary|slot-N|mini-N|pane> <msg...>");
      process.exit(2);
    }
    try {
      const { paneId, targetLabel } = enqueuePrompt(loaded, target, msg, { manager: true });
      console.log(`OK: peer -> ${targetLabel} pane=${paneId} (daemon inject when idle)`);
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
      miniSpawnAll(loaded, reg);
      return;
    }
    if (sub === "spawn") {
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
    if (sub === "start") {
      secretaryLaunch(loaded);
      return;
    }
    if (sub === "restart") {
      const reg = createRegistryForProfile(loaded.profile);
      secretaryRestart(loaded, reg);
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
        secretarySupervise(loaded, reg, "on", tail[1] ?? "5m");
        return;
      }
      if (action === "off") {
        secretarySupervise(loaded, reg, "off");
        return;
      }
      secretarySupervise(loaded, reg, "status");
      return;
    }
    console.error(
      "usage: secretary start|restart|status|supervise on [5m]|supervise off|watch on [5m]|watch off",
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

  if (cmd === "seat" && sub === "init") {
    const loaded = meshLoaded(profileArg);
    const { created, ensured } = runSeatInit(loaded);
    console.log(
      `OK: seat init (ensured=${ensured.length} created=${created.length} — idempotent, never overwrites FOCUS/TASKS)`,
    );
    for (const p of created.slice(0, 12)) console.log(`  + ${p}`);
    if (created.length > 12) console.log(`  ... +${created.length - 12} more`);
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
    const { paneId, targetLabel } = enqueuePrompt(loaded, target, text, { manager });
    console.log(`OK: queued -> ${targetLabel} pane=${paneId} (daemon inject when idle)`);
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

  if (cmd === "flush") {
    const loaded = meshLoaded(profileArg);
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
    const reg = createRegistryForProfile(loaded.profile);
    const args = [sub, ...tail].filter(Boolean);
    if (args.length < 2) {
      console.error(
        "usage: switch <target> <agent|kiro|claude|opencode|empty> [--fresh|--resume ID] [reason...]",
      );
      process.exit(2);
    }
    const target = args[0]!;
    const newType = args[1]!;
    let fresh = false;
    let resumeId: string | undefined;
    const reasonParts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const a = args[i]!;
      if (a === "--fresh") fresh = true;
      else if (a === "--resume" && args[i + 1]) resumeId = args[++i];
      else if (a.startsWith("--resume=")) resumeId = a.slice("--resume=".length);
      else reasonParts.push(a);
    }
    const reason = reasonParts.join(" ") || undefined;
    submitPaneOp(
      loaded,
      "switch",
      { target, newType, fresh, resumeId, reason },
      `switch ${target} -> ${newType}`,
      () =>
        runSwitch(loaded, reg, target, newType, {
          fresh,
          resumeId,
          reason,
        }),
    );
    return;
  }

  if (cmd === "report") {
    const loaded = meshLoaded(profileArg);
    const { printStatusReport } = await import("./status-report.js");
    const report = await printStatusReport(loaded, { json: rest.includes("--json") });
    process.exit(report.ok ? 0 : 1);
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
    const w = runWhoami(loaded, sub || tail[0]);
    printAgentCard(w);
    return;
  }

  if (cmd === "whoami" || cmd === "where") {
    if (cmd === "where") {
      console.error("note: where is deprecated — use ./sm.sh whoami");
    }
    const loaded = meshLoaded(profileArg);
    printWhoami(loaded, sub || tail[0]);
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
    const isManager = w.role === "manager" || w.role === "manager-2";
    const label =
      w.role === "manager-2"
        ? "yes: manager-2"
        : isManager
          ? "yes: manager"
          : `no: role=${w.role}`;
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
    console.error("usage: base ensure");
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
    const reg = createRegistryForProfile(loaded.profile);
    const file = saveMeshSession(loaded, reg);
    const m = loaded.profile.layout?.minis;
    const layoutNote = m
      ? ` minis=${m.grid} max=${m.max} leads=[${Array.isArray(m.leads) ? m.leads.join(",") : "?"}]`
      : "";
    console.log(`OK: saved ${file}${layoutNote}`);
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

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(2);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

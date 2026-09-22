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
  chatRoomConfigForLoaded,
  clearAckEndedSync,
  resolveAckRedirectDefaults,
  expandTargetSpec,
  targetRangeOptsFromProfile,
} from "@seat-mesh/core";
import { snapshotConnectivity, formatStatus } from "@seat-mesh/connectivity";
import { createRegistryForProfile, loadDropInProviders } from "@seat-mesh/providers";
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
  assertAgentDispatch,
  printAgentUnauthorized,
  stripAgentFromArgv,
  AGENT_META,
  capturePaneSnapshot,
  listSessionPanes,
  sessionAttach,
  sessionUp,
  finishSessionUp,
  sessionDown,
  sessionStatus,
  sessionSync,
  tmuxHasSession,
  relayoutMeshSession,
  realignAllLayouts,
  scaleLayout,
  layoutReload,
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
  defaultHarnessTypeForSeat,
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
  runSwitchFast,
  runPaneResume,
  runSeatSwap,
  runSet,
  runTag,
  setPaneTitle,
  setPaneStatus,
  printSeatContexts,
  runAgentHub,
  runPeek,
  runPaneKind,
  runPaneMeta,
  runPaneCapture,
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
  kindsForLoaded,
} from "@seat-mesh/tmux";
import { parseAgentApplyArgs, lookupResolvedKind } from "@seat-mesh/core";
import { buildCheckbackCommands } from "./commands/checkback-cli.js";
import { buildTargetCommands } from "./commands/target-cli.js";
import { buildAckCommands } from "./commands/ack-cli.js";
import {
  resolvePeerEndedAckId,
  shouldAutoAckReply,
} from "./commands/ack-reply.js";
import { buildLimitCommands } from "./commands/limit-cli.js";
import { buildRolesCommands } from "./commands/roles-cli.js";
import { runInit } from "./setup/init.js";
import { runAgentContextInit } from "./setup/agent-context-init.js";
import {
  printSessionCheck,
  printSessionRepair,
  runSessionCheck,
  runSessionRepair,
} from "./setup/session-health.js";
import { runSeatCommand } from "./commands/seat-cli.js";
import { coordCommand } from "./commands/coord-cli.js";

function parseArgs(argv: string[]) {
  const profileFlag: string[] = [];
  const rest: string[] = [];
  let agentsHelp = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile" || a === "-p") {
      const v = argv[++i];
      if (!v) throw new Error("--profile requires a path");
      profileFlag.push(v);
      continue;
    }
    if (a === "--agents" || a === "--agent-help") {
      agentsHelp = true;
      continue;
    }
    rest.push(a);
  }
  return { profile: profileFlag[0], rest, agentsHelp };
}

/** Profile yaml + mesh-agents.json layout overrides (yaml is fallback only). */
function meshLoaded(profileArg?: string) {
  return applyMeshState(loadProfile(profileArg));
}

/** Operator-facing help — human/session verbs only (default `seatmesh help`). */
function usageHuman(loaded?: ReturnType<typeof loadProfile>): void {
  const prof = loaded ? `profile=${loaded.profile.name}` : "";
  console.log(`seatmesh${prof ? ` (${prof})` : ""} — operator CLI (human surface)

  Docs: README.md + docs/QUICKSTART.md · full agent+human list: seatmesh --agents help

Setup
  start | run | init | install | update | version
  session attach|up|down|status|sync|init <sm-name>
  sessions [list|attach|forget|register]

Put an agent on a pane
  help human          ← cheat sheet (aliases: put-agent | panes)
  spawn <target> <opencode|opencode-cpe|claude|agent|kiro>   empty → CLI
  switch <target> <…|empty>   replace live agent (or → shell)
  kill|empty <target>         pane → plain terminal (+ save empty)
  launch <target|all>         resume configured CLI
  kind <target>

Work / status
  todo give <target> "…" | todo <target> "…" | assign <target> "…"
  todo list [target] | todo check <target> "…"
  target add|list|done|triage
  report | verify | test | save|auto | inbox […] | labels

Session shape
  rebuild|reload [--layout]   npm build + labels (not config→pane)
  layout reload               re-grid + resume from mesh-agents.json
  layout […] | realign | ops list|clear

Agent panes use the gateway (not listed here by default):
  seatmesh agent …          · seatmesh agent help
  seatmesh --agents help    · show human + agent + shared verbs

  --profile <dir|yaml>   optional; default walk-up .sm/
`);
}

/** Full help — human + agent + shared (`seatmesh --agents help`). */
function usage(loaded?: ReturnType<typeof loadProfile>): void {
  const prof = loaded ? `profile=${loaded.profile.name}` : "";
  console.log(`seatmesh${prof ? ` (${prof})` : ""} — profile-driven tmux multi-agent CLI

  Docs: README.md + docs/ONE-PATH.md + docs/QUICKSTART.md
  Cold start: bin/sm (or bin/seatmesh) auto-runs npm install + build when dist is stale
  Default operator help (human-only): sm help   ·  this list: sm --agents help
  Prefer alias \`sm\` (\`sm install\` → ~/.local/bin). \`./sm.sh\` is retired.

Setup (run once per project, by a human)
  start               ONE command: init if needed + create-or-attach session (fresh or existing)
  run                 logs-window left pane: status line → interactive $SHELL (npx seatmesh run)
  init [--force] [--seats-root PATH] [--name NAME]   create .sm/ dotdir only
  session init <sm-name> [--force] [--name NAME]   create .sm-<name>/ (multi-config)
  sessions [list|attach|forget|register] [--json]   global registry + TUI picker (all meshes)
  install [--bin DIR] [--force]       symlink tracked bin/sm + seatmesh → ~/.local/bin
  update [--dry-run] [--migrate] [--no-restart-inbox]
                                        1) npm i -g seatmesh@latest  2) refresh .sm/_vendor
  config check | config upgrade         validate yaml · how to bump CLI (npm i -g)
  web up|down|restart|status|open|url   operator hub :3190 (npx seatmesh web up)
  roles status|migrate [--to VER]|steps   locked role-pack up/down (1.1.x)
  host up|down|status   opt-in single host-supervisor for all registered meshes (Phase 1)
  version [--json] [--check-registry]   CLI vs npm latest vs profile .seatmesh-version

Put an agent on a pane (human — most common)
  help human          ← full cheat sheet (aliases: put-agent | panes)
  switch <target> <opencode|opencode-cpe|claude|agent|kiro>   empty shell → agent CLI
  switch <target> empty                          agent → plain shell
  launch <target|all>                            resume configured CLI (no type pick)
  pane resume [target]                           autodetect session id → resume/relaunch
  kind <target>                                  agent vs terminal?
  Examples: switch slot-1 opencode · switch secretary opencode-cpe · pane resume here

Give a seat a todo (human or base agent — contracts optional)
  todo give <target> "…"     ← FOCUS+TASK+inject+CB≥20m  (preferred)
  todo <target> "…"          ← same shorthand
  assign <target> "…"        ← same engine
  todo list [target] | todo check <target> "…"
  Examples: todo give slot-1 "fix login" · agent todo mini-2 "draft README"

Status / diagnostics
  report [--json] [--verbose]   stack status (one line default; --verbose = full section dump)
  verify              layout + labels health
  test                          smoke: layout, providers, inbox, proxy

Session / layout (infra shape, operator or manager)
  session attach|up|down|status|sync|init <sm-name>
  reload [--layout]   rebuild engine + labels (no session kill; --layout re-grids)
  layout [--no-leads] [--dry-run] [--yes]   workers + minis grid (queued)
  layout column list|add <id> [--cli P] [--after ID] [--co-typed]|remove <id>
                                 N base columns (managers/secretaries) are config, not enum
  realign               resize-only: base ratio + worker/mini equal grids
  ops list|clear                pane-op queue (serial)
  save|auto [--json] [--no-labels]   scrape session -> mesh-agents.json (+ labels; daemon auto-scrapes every 60s + detach hook)
  labels                        re-apply @mesh_* + border strip
  inbox [--json] [--wait N] [--meta] | inbox list|resolve|log|instances|stop|restart

Agent runtime (pane — always via gateway)
  agent                     scoped can/cannot for this pane
  agent <cmd> …             run <cmd> if allowed; else UNAUTHORIZED
  agent context [roles|init]  registered read_first/files; init scaffolds .sm
  agent contract [status|on|off|open]   simple locks (prefer over apply)
  agent apply|preflight …   legacy multi-clause DSL

  Shared/operator (outside agent — humans + session ops)
  run | session | update | init | report | test | layout | save | inbox restart | target …

  Examples: switch slot-1 opencode | agent whoami | agent help peer | agent hub | agent kind slot-1
  Discover: help human  # put agent on pane · help <cmd> · agent help <cmd> · <cmd> --help
  Tab complete: eval "$(seatmesh completion zsh)"  # or bash|fish; see: completion install
  Operator EOD: target add "finish s13 tickets" [--deadline eod|6h] · target list · target done <id> · target triage <id>

  --profile <dir|yaml>   optional; default walk-up .sm/; multi-config: --profile .sm-<name>
  --agents               with help: show this full human+agent surface (default help is human-only)
`);
}

function printPlainUsage(profileArg?: string, agentsHelp = false): void {
  const print = agentsHelp ? usage : usageHuman;
  if (profileArg) {
    try {
      print(meshLoaded(profileArg));
      return;
    } catch {
      /* fall through — plain help without profile load */
    }
  }
  print();
}

async function main(): Promise<void> {
  const { profile: profileArg, rest, agentsHelp } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...tail] = rest;

  // Bare `npx seatmesh` / help: logo+version once per terminal; later invocations plain usage.
  // `help <cmd>` → per-command usage (agents: `agent help <cmd>`).
  // Default help = human-only; `--agents help` = full human+agent surface.
  const helpCmd = cmd === "-h" || cmd === "--help" || cmd === "help";
  const blankCmd = !cmd || (cmd.startsWith("-") && !helpCmd);
  if (cmd === "--skill" || cmd === "skill") {
    const { runSkillCommand } = await import("./commands/skill-cli.js");
    runSkillCommand(rest.includes("--json"));
    return;
  }
  if (helpCmd && cmd === "help" && sub && sub !== "--agents") {
    const { printCmdHelp } = await import("./commands/help-text.js");
    if (!printCmdHelp(sub)) process.exit(2);
    return;
  }
  if (blankCmd || helpCmd) {
    const { printSeatmeshBanner } = await import("./ui/banner.js");
    const {
      formatHelpVersionBlock,
      installKindLabel,
      readInstalledCliVersion,
      resolveLatestRegistryVersion,
    } = await import("./ui/version-nudge.js");
    const showedBrand = printSeatmeshBanner({ tagline: true });
    if (showedBrand) {
      const installed = readInstalledCliVersion();
      const latest = resolveLatestRegistryVersion(false);
      for (const line of formatHelpVersionBlock(installed, latest, installKindLabel())) {
        console.log(line);
      }
      console.log("");
    }
    printPlainUsage(profileArg, agentsHelp);
    const { printGlobalHelpHint } = await import("./commands/help-text.js");
    printGlobalHelpHint(agentsHelp);
    return;
  }

  // Per-command --help / `cmd help` — never execute the verb (no launch/reload/whoami side effects).
  if (cmd !== "agent") {
    const { wantsCmdHelp, printCmdHelp } = await import("./commands/help-text.js");
    if (wantsCmdHelp(rest)) {
      if (!printCmdHelp(cmd)) process.exit(2);
      return;
    }
  }

  // Universal shorthands (all agents): ask/msg/tell → peer; ackmsg → peer --ack; reply → ack reply
  if (
    cmd === "ask" ||
    cmd === "msg" ||
    cmd === "tell" ||
    cmd === "ackmsg" ||
    cmd === "answered" ||
    cmd === "reply"
  ) {
    const { expandAgentShorthand } = await import("./commands/agent-shorthand.js");
    const args = [sub, ...tail].filter((a): a is string => a != null && a !== "");
    try {
      const { argvRest, label } = expandAgentShorthand(cmd, args);
      console.error(`shorthand: ${label}`);
      const bin = process.argv[0]!;
      const script = process.argv[1]!;
      // Preserve --profile if present in original argv
      const profileIdx = process.argv.indexOf("--profile");
      const profileArgs =
        profileIdx >= 0 && process.argv[profileIdx + 1]
          ? ["--profile", process.argv[profileIdx + 1]!]
          : process.argv.some((a) => a.startsWith("--profile="))
            ? [process.argv.find((a) => a.startsWith("--profile="))!]
            : [];
      process.argv = [bin, script, ...profileArgs, ...argvRest];
      return main();
    } catch (e) {
      console.error((e as Error).message);
      process.exit(2);
    }
  }

  const { maybePrintVersionNudge } = await import("./ui/version-nudge.js");
  // Attach/session picker must not wait on npm view — operator is trying to get into tmux.
  const skipNudge =
    process.env.SEATMESH_SKIP_VERSION_CHECK === "1" ||
    cmd === "session" ||
    cmd === "sessions" ||
    cmd === "start" ||
    cmd === "completion";
  if (!skipNudge) maybePrintVersionNudge();

  if (cmd === "completion") {
    const { runCompletionCommand } = await import("./commands/completion.js");
    runCompletionCommand([sub, ...tail].filter((a): a is string => a != null));
    return;
  }

  if (cmd === "version") {
    const { printVersionInfo } = await import("./ui/version-nudge.js");
    let profileDir: string | undefined;
    try {
      profileDir = meshLoaded(profileArg).profileDir;
    } catch {
      /* no profile — CLI only */
    }
    printVersionInfo({
      profileDir,
      json: rest.includes("--json"),
      forceRegistryCheck: rest.includes("--check-registry"),
    });
    return;
  }

  if (cmd === "install") {
    const { runInstall, defaultInstallBinDir } = await import("./setup/install.js");
    let binDir = defaultInstallBinDir();
    const force = rest.includes("--force");
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--bin" && rest[i + 1]) {
        binDir = rest[++i]!;
      }
    }
    const r = runInstall({ binDir, force });
    console.log(
      `OK: install ${r.created ? "linked" : "already linked"} ${r.link} -> ${r.target}`,
    );
    console.log(`  bin dir: ${r.binDir} (ensure it is on PATH)`);
    return;
  }

  if (cmd === "host") {
    const { runHostCommand } = await import("./commands/host-cli.js");
    const code = runHostCommand([sub, ...tail].filter((a): a is string => a != null));
    if (code !== 0) process.exit(code);
    return;
  }

  if (cmd === "update") {
    const { runUpdate } = await import("./setup/update.js");
    const {
      formatInstallStatusLine,
      isNpxEphemeralInstall,
      readInstalledCliVersion,
      resolveLatestRegistryVersion,
      semverLess,
    } = await import("./ui/version-nudge.js");
    const dryRun = rest.includes("--dry-run");
    const migrate = rest.includes("--migrate");
    const noRestartInbox = rest.includes("--no-restart-inbox");
    const installed = readInstalledCliVersion();
    const npmLatest = resolveLatestRegistryVersion(true);

    // Lead with CLI upgrade — most users think "update" means bump the package.
    console.log("seatmesh update — two steps");
    console.log("  1) CLI package (do this first if you want npm latest):");
    console.log("       npm install -g seatmesh@latest");
    console.log("       # or: npx seatmesh@latest update");
    console.log("  2) This command: refresh .sm/_vendor + config merge from the CLI you ran");
    console.log("     (see also: seatmesh config upgrade)");
    console.log("");
    console.log(formatInstallStatusLine(installed, npmLatest));
    if (npmLatest && semverLess(installed, npmLatest)) {
      console.error(
        `  WARN: CLI ${installed} < npm ${npmLatest} — step 1 first, then re-run update`,
      );
    }

    const r = runUpdate({ profileArg, dryRun, migrate });
    console.log(`OK: profile update dryRun=${dryRun} migrate=${migrate}`);
    console.log(`  CLI running: ${r.packageVersion}`);
    if (r.previousVersion != null) {
      console.log(
        `  profile .seatmesh-version: ${r.previousVersion} (last profile update — not npm "installed")`,
      );
    } else {
      console.log(`  profile .seatmesh-version: (none yet)`);
    }
    if (npmLatest) console.log(`  npm latest: ${npmLatest}`);
    console.log(`  paths: ${r.pathsManifest}`);
    for (const line of r.refreshed) console.log(`  refreshed: ${line}`);
    for (const line of r.skipped) console.log(`  skipped (unchanged): ${line}`);
    if (r.migrate) {
      for (const line of r.migrate.copied) console.log(`  migrate copied: ${line}`);
      for (const line of r.migrate.skipped) console.log(`  migrate skipped: ${line}`);
    }
    if (r.rolePack) {
      console.log(
        `  role-pack: ${r.rolePack.direction} ${r.rolePack.from ?? "none"} → ${r.rolePack.to}` +
          (r.rolePack.steps.length ? ` [${r.rolePack.steps.join(",")}]` : ""),
      );
    }
    if (r.configMerge?.added.length) {
      console.log(
        `  config-merge: ${r.configMerge.added.join(", ")}` +
          (dryRun ? " (dry-run)" : ""),
      );
    }
    if (isNpxEphemeralInstall()) {
      console.log(
        "  note: npx cache CLI — profile vendor updated only; use npm i -g seatmesh@latest to pin a global bin",
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

  if (cmd === "roles") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildRolesCommands(getLoaded);
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
    // One command for fresh OR existing: init if needed → attach (creates if missing).
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
    if (tmuxHasSession(loaded.sessionName)) {
      console.log(`OK: session '${loaded.sessionName}' already up — attaching`);
      printMeshInboxStatus(loaded);
    } else {
      console.log(
        `OK: creating session '${loaded.sessionName}' (manager = terminal + whoami/switch hints)`,
      );
    }
    sessionAttach(loaded);
    return;
  }

  if (cmd === "run") {
    // Logs window left pane: one-liner status, then plain interactive shell.
    const loaded = meshLoaded(profileArg);
    const port = meshInboxPort(loaded);
    console.log(
      `seatmesh run · session=${loaded.sessionName} · workspace=${loaded.workspace} · inbox=:${port}`,
    );
    console.log(`tips: seatmesh agent · seatmesh report · seatmesh inbox · seatmesh help`);
    const shell = process.env.SHELL || "/bin/bash";
    const r = spawnSync(shell, ["-l"], {
      cwd: loaded.workspace,
      stdio: "inherit",
      env: process.env,
    });
    process.exit(typeof r.status === "number" ? r.status : 1);
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
    console.log("  next: npx seatmesh start");
    return;
  }

  if (cmd === "sessions") {
    const { runSessionsCommand, printAgentSessionsList } = await import(
      "./commands/sessions-cli.js"
    );
    // After `agent sessions` strip: only list/json — never attach/pick/forget/register.
    const fromAgent = process.env.SEATMESH_AGENT_GATEWAY === "1";
    if (fromAgent) {
      const action = (sub ?? "list").toLowerCase();
      if (["attach", "forget", "register", "pick", "add"].includes(action)) {
        console.error(
          `UNAUTHORIZED: sessions ${action} is operator-only — run without agent: seatmesh sessions ${action} …`,
        );
        console.error("hint: seatmesh agent sessions   # list other meshes");
        console.error('hint: seatmesh agent peer @pia:secretary "…"  # cross-mesh');
        process.exit(2);
      }
      const loaded = meshLoaded(profileArg);
      await printAgentSessionsList(loaded, { json: rest.includes("--json") || tail.includes("--json") });
      return;
    }
    process.exit(await runSessionsCommand(sub, tail, profileArg));
  }

  if (cmd === "remote" || cmd === "meshes") {
    const loaded = meshLoaded(profileArg);
    const { printAgentSessionsList } = await import("./commands/sessions-cli.js");
    const json = rest.includes("--json") || sub === "--json";
    // bare / list / --json → discover
    if (!sub || sub === "list" || sub === "--json" || sub === "-h" || sub === "--help") {
      if (sub === "-h" || sub === "--help") {
        const { printCmdHelp } = await import("./commands/help-text.js");
        printCmdHelp("remote");
        return;
      }
      await printAgentSessionsList(loaded, { json });
      return;
    }
    // remote @alias:seat <msg...>
    const atTarget = parseRemotePeerTarget(sub);
    if (atTarget) {
      const rawMsg = [ ...tail ].join(" ").trim();
      if (!rawMsg) {
        console.error('usage: remote @alias:seat "<msg>"');
        process.exit(2);
      }
      runRemotePeer(loaded, atTarget.alias, atTarget.seat, rawMsg);
      return;
    }
    // remote <alias> <seat> <msg...>
    const alias = sub.replace(/^@/, "");
    const seat = tail[0];
    const rawMsg = tail.slice(1).join(" ").trim();
    if (!seat || !rawMsg) {
      console.error('usage: remote <alias> <seat> "<msg>"');
      console.error('   or: remote @alias:seat "<msg>"');
      console.error("   or: remote [--json]   # list meshes");
      process.exit(2);
    }
    if (!/^[a-z][a-z0-9-]{0,31}$/i.test(alias) || !/^[a-z][a-z0-9-]{0,31}$/i.test(seat)) {
      console.error(`bad remote target: ${alias} ${seat} (want alias seat, e.g. pia secretary)`);
      process.exit(2);
    }
    runRemotePeer(loaded, alias.toLowerCase(), seat.toLowerCase(), rawMsg);
    return;
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
    if (sub === "init") {
      const { normalizeSmProfileDir } = await import("@seat-mesh/core");
      const rawName = tail[0];
      if (!rawName || rawName.startsWith("-")) {
        console.error("usage: session init <sm-name> [--force] [--name NAME]");
        console.error("  creates .sm-<name>/ (default project config is still .sm via: init)");
        console.error("  then: seatmesh --profile .sm-<name> start");
        process.exit(2);
      }
      const force = tail.includes("--force");
      const nameIdx = tail.indexOf("--name");
      const profileName =
        nameIdx >= 0 && tail[nameIdx + 1] ? tail[nameIdx + 1] : undefined;
      const smDirName = normalizeSmProfileDir(rawName);
      const r = runInit({ force, name: profileName, smDirName });
      console.log(`OK: session init ${r.smDir}`);
      console.log(`  config: ${r.configPath}`);
      console.log(`  created: ${r.created.length} file(s)`);
      if (r.skipped.length) console.log(`  skipped (exists): ${r.skipped.length}`);
      try {
        const { upsertGlobalSession } = await import("@seat-mesh/core");
        await upsertGlobalSession(meshLoaded(r.configPath));
      } catch {
        /* non-fatal */
      }
      console.log(`  next: seatmesh --profile ${smDirName} start`);
      console.log(`  agents: seatmesh --profile ${smDirName} agent …`);
      console.log(`  default .sm/ still needs no --profile (walk-up)`);
      return;
    }
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
    if (sub === "down" || sub === "stop" || sub === "kill") {
      const r = sessionDown(loaded);
      console.log(
        `OK: session down name=${loaded.sessionName} killed=${r.sessionKilled} inboxStopped=${r.inboxStopped}`,
      );
      return;
    }
    if (sub === "attach" || !sub) {
      // Don't block tmux attach on registry I/O — fire and forget.
      void touchRegistry();
      sessionAttach(loaded);
      return;
    }
    if (sub === "sync") {
      sessionSync(loaded);
      console.log(`OK: session sync ${loaded.sessionName}`);
      printMeshInboxStatus(loaded);
      return;
    }
    if (sub === "finish-up") {
      // Internal — spawned detached by sessionUp so `start`/`session up` can
      // attach immediately instead of blocking on every seat's agent CLI
      // booting. Not meant for direct interactive use, same spirit as `sync`.
      finishSessionUp(loaded);
      console.log(`OK: session finish-up ${loaded.sessionName}`);
      return;
    }
    if (sub === "status") {
      sessionStatus(loaded);
      return;
    }
    if (sub === "check") {
      const r = runSessionCheck(loaded);
      printSessionCheck(r);
      process.exit(r.ok ? 0 : 1);
    }
    if (sub === "repair") {
      const noSync = tail.includes("--no-sync");
      const skipInbox = tail.includes("--no-inbox");
      const r = runSessionRepair(loaded, { sync: !noSync, skipInbox });
      printSessionRepair(r);
      process.exit(r.check.ok ? 0 : 1);
    }
    console.error(
      "usage: session attach|up|down|status|sync|check|repair|init <sm-name>",
    );
    process.exit(2);
  }

  if (cmd === "config") {
    const { runConfigCheck, printConfigHelp, printConfigUpgradeGuide } = await import(
      "./commands/config-cli.js"
    );
    const json = rest.includes("--json") || sub === "--json" || tail.includes("--json");
    if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
      printConfigHelp();
      return;
    }
    if (sub === "check") {
      process.exit(runConfigCheck(profileArg, { json }));
    }
    if (sub === "upgrade" || sub === "up") {
      printConfigUpgradeGuide();
      return;
    }
    console.error("usage: config check [--json] | config upgrade");
    process.exit(2);
  }

  if (cmd === "tp") {
    const loaded = meshLoaded(profileArg);
    const { runTpCommand } = await import("./commands/tp-cli.js");
    await runTpCommand(loaded, sub, tail);
    return;
  }

  if (cmd === "web" || cmd === "open-web") {
    // Host-level view over the global session registry (same spirit as
    // `seatmesh host`), not tied to any one project — works from anywhere,
    // .sm/ workspace or not.
    let loaded: ReturnType<typeof meshLoaded> | null = null;
    try {
      loaded = meshLoaded(profileArg);
    } catch {
      /* no project in cwd — web-cli.ts handles null loaded */
    }
    const { runWebCommand, runWebOpen } = await import("./commands/web-cli.js");
    if (cmd === "open-web") {
      process.exit(runWebOpen(sub));
    }
    process.exit(await runWebCommand(loaded, sub, tail));
  }

  if (cmd === "verify") {
    const loaded = meshLoaded(profileArg);
    ensureMeshInbox(loaded, { quiet: true });
    const layoutOk = printVerify(verifyMeshSession(loaded));
    const inboxOk = printMeshInboxStatus(loaded);
    process.exit(layoutOk && inboxOk ? 0 : 1);
  }

  if (cmd === "reload" || cmd === "rebuild") {
    const loaded = meshLoaded(profileArg);
    const layout = rest.includes("--layout");
    reloadMesh(loaded, { layout });
    console.log(
      layout
        ? `OK: rebuild + relayout session ${loaded.sessionName}`
        : `OK: rebuild (npm build + labels) session ${loaded.sessionName} — not config→pane`,
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

  if (cmd === "layout" && sub === "scale") {
    const loaded = meshLoaded(profileArg);
    const kindRaw = (tail[0] ?? "").toLowerCase();
    const kind =
      kindRaw === "workers" || kindRaw === "worker" || kindRaw === "w"
        ? "workers"
        : kindRaw === "minis" || kindRaw === "mini" || kindRaw === "m"
          ? "minis"
          : null;
    const action = (tail[1] ?? "").toLowerCase();
    const force = rest.includes("--yes");
    const dryRun = rest.includes("--dry-run");
    if (!kind || !action) {
      console.error(
        "usage: layout scale workers|minis up|down|<N> [--yes] [--dry-run]",
      );
      process.exit(2);
    }
    requireCoordRole(loaded, "layout scale");
    if (action !== "up" && action !== "down") {
      const n = Number(action);
      if (!Number.isInteger(n) || n < 1) {
        console.error("usage: layout scale workers|minis up|down|<N> [--yes] [--dry-run]");
        process.exit(2);
      }
    }
    try {
      const r =
        action === "up" || action === "down"
          ? scaleLayout(loaded, {
              kind,
              dir: action,
              force,
              dryRun,
            })
          : scaleLayout(loaded, {
              kind,
              to: Number(action),
              force,
              dryRun,
            });
      if (r.dryRun) {
        console.log(
          `dry-run: scale ${r.kind} ${r.from} → ${r.to} (${r.grid})`,
        );
        return;
      }
      if (r.from === r.to) {
        console.log(`OK: scale ${r.kind} already ${r.to} (${r.grid})`);
        return;
      }
      console.log(
        `OK: scale ${r.kind} ${r.from} → ${r.to} (${r.grid})${r.saved ? ` saved ${r.saved}` : ""}`,
      );
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "layout" && sub === "reload") {
    const loaded = meshLoaded(profileArg);
    const force = rest.includes("--yes");
    const skipLeads = rest.includes("--no-leads");
    const noResume = rest.includes("--no-resume");
    requireCoordRole(loaded, "layout reload");
    try {
      const r = layoutReload(loaded, {
        force,
        skipMinisLeads: skipLeads,
        noResume,
      });
      const launched = r.repaired.filter((x) => x.status === "launched");
      const failed = r.repaired.filter((x) => x.status === "failed");
      console.log(
        `OK: layout reload ${loaded.sessionName} repaired=${launched.length}${r.saved ? ` saved ${r.saved}` : ""}`,
      );
      for (const x of launched) {
        console.log(`  resume ${x.label} ${x.paneId}`);
      }
      for (const x of failed) {
        console.warn(`  fail ${x.label}: ${x.reason ?? x.status}`);
      }
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
          `OK: relayout ${loaded.sessionName} (workers ${loaded.profile.layout?.workers.grid ?? "?"}, minis ${grid}${leadNote})`,
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
    console.error('DEPRECATED: use seatmesh --profile .sm agent room say [-r managers] "DONE|BLOCKED|…"');
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
    const redirDefaults = resolveAckRedirectDefaults(loaded);
    let direct = false;
    let endedId: string | undefined;
    let redirectFrom: string | undefined;
    let redirectBlock = redirDefaults.block;
    let redirectTo = redirDefaults.rewriteTo;
    let redirectTtlMin = redirDefaults.ttlMin;
    const args: string[] = [];
    const rawArgs = [sub, ...tail].filter((x): x is string => x != null && x !== "");
    for (let i = 0; i < rawArgs.length; i++) {
      const a = rawArgs[i]!;
      if (a === "--direct" || a === "--now") {
        direct = true;
        continue;
      }
      if (a === "--ended" || a === "--ack") {
        const id = rawArgs[i + 1];
        if (!id || id.startsWith("-")) {
          // Bare --ack / --ended: auto-pick open ACK for this peer target.
          endedId = "__auto__";
          continue;
        }
        endedId = id;
        i++;
        continue;
      }
      if (a.startsWith("--ended=") || a.startsWith("--ack=")) {
        endedId = a.slice(a.indexOf("=") + 1).trim();
        if (!endedId) {
          console.error("usage: peer … --ended <ack-id>");
          process.exit(2);
        }
        continue;
      }
      if (a === "--redirect-from") {
        const v = rawArgs[i + 1];
        if (!v || v.startsWith("-")) {
          console.error("usage: peer … --redirect-from <mini-N|worker-N>");
          process.exit(2);
        }
        redirectFrom = v;
        i++;
        continue;
      }
      if (a.startsWith("--redirect-from=")) {
        redirectFrom = a.slice("--redirect-from=".length).trim();
        continue;
      }
      if (a === "--redirect-block") {
        const v = rawArgs[i + 1];
        if (!v || v.startsWith("-")) {
          console.error("usage: peer … --redirect-block <manager|*managers>");
          process.exit(2);
        }
        redirectBlock = v;
        i++;
        continue;
      }
      if (a === "--redirect-ttl") {
        const v = rawArgs[i + 1];
        if (!v || v.startsWith("-")) {
          console.error("usage: peer … --redirect-ttl <minutes>");
          process.exit(2);
        }
        redirectTtlMin = Number(v) || redirDefaults.ttlMin;
        i++;
        continue;
      }
      args.push(a);
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
    const [targetRaw, ...textParts] = args;
    const rawMsg = textParts.join(" ").trim();
    if (!targetRaw || !rawMsg) {
      console.error(
        "usage: peer verify [target] | peer [--direct] [--ended|--ack [ack-id]] [--redirect-from <seat>] <target> <msg...>\n" +
          "  target: seat | 1..4 | slot-1..3 | mini-1..2 | 1,3,5  (Ruby-style fanout)\n" +
          "  --ack / --ended [id]  close open ask (id optional = auto-match from target)\n" +
          "  ack-class msg (ACK/FYI/PASS) auto-closes matching open ask\n" +
          "  or: agent ack reply <id> [msg]  (peer back + close in one shot)",
      );
      process.exit(2);
    }
    const peerTargets = expandTargetSpec(
      targetRaw,
      targetRangeOptsFromProfile(loaded.profile),
    );
    if (peerTargets.length > 1 && endedId) {
      console.error("WARN: --ack/--ended ignored on range fanout (send-only)");
      endedId = undefined;
    }
    const target = peerTargets[0]!;
    if (peerTargets.length > 1) {
      for (const t of peerTargets) {
        try {
          runPeer(loaded, t, rawMsg);
        } catch (e) {
          if ((e as Error).message !== "__peer_coord__") {
            console.error(`FAIL peer ${t}: ${(e as Error).message}`);
            continue;
          }
          requireCoordRole(loaded, "peer");
          if (direct) {
            const reg = createRegistryForProfile(loaded.profile);
            injectPromptDirect(loaded, reg, t, rawMsg, { manager: true, force: true });
            console.log(`SENT: peer --direct -> ${t}`);
          } else {
            const { paneId, targetLabel, token, via } = enqueuePrompt(loaded, t, rawMsg, {
              manager: true,
              armCheckback: false,
            });
            console.log(
              via === "queued"
                ? `QUEUED: peer -> ${targetLabel} pane=${paneId} token=${token ?? "-"}`
                : `SENT: peer -> ${targetLabel} pane=${paneId}`,
            );
          }
        }
      }
      console.log(`ok fanout peer → ${peerTargets.join(",")} (${peerTargets.length})`);
      return;
    }
    if (shouldAutoAckReply(rawMsg, endedId)) {
      endedId = "__auto__";
    }
    try {
      const resolvedEnded = await resolvePeerEndedAckId(loaded, target, endedId);
      endedId = resolvedEnded;
    } catch (e) {
      if (endedId === "__auto__") {
        console.error(`WARN: --ack auto: ${(e as Error).message}`);
        endedId = undefined;
      } else {
        throw e;
      }
    }
    if (endedId === "__auto__") {
      console.error(
        `WARN: --ack auto: no open ask matching ${target} — peer sent without close`,
      );
      endedId = undefined;
    }
    const armRedirect = async (fromSeat: string, reason: string) => {
      const cfg = chatRoomConfigForLoaded(loaded);
      try {
        const res = await fetch(`${cfg.inboxBase.replace(/\/$/, "")}/ack/redirect-block`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromSeat,
            blockTarget: redirectBlock,
            rewriteTo: redirectTo,
            ttlMin: redirectTtlMin,
            armedBy: "peer-redirect",
            reason,
          }),
        });
        const body = (await res.json()) as { ok?: boolean; block?: { id: string; untilMs: number }; error?: string };
        if (!res.ok || !body.ok) {
          console.error(`WARN: ack-redirect arm failed: ${body.error ?? res.status}`);
          return;
        }
        console.log(
          `ok ack-redirect ${fromSeat} ${redirectBlock}→${redirectTo} until=${new Date(body.block!.untilMs).toISOString()}`,
        );
      } catch (e) {
        console.error(`WARN: ack-redirect arm failed: ${(e as Error).message}`);
      }
    };
    const finishEnded = async () => {
      if (!endedId) return;
      const cfg = chatRoomConfigForLoaded(loaded);
      // Before clear: capture `from` so we can auto-arm redirect when peening secretary.
      let endedFrom: string | undefined;
      try {
        const list = await fetch(`${cfg.inboxBase.replace(/\/$/, "")}/ack?all=1`);
        const data = (await list.json()) as { entries?: { id: string; from?: string }[] };
        const hit = (data.entries ?? []).find(
          (r) => r.id === endedId || r.id.startsWith(endedId!) || endedId!.startsWith(r.id.slice(0, 8)),
        );
        endedFrom = hit?.from?.trim();
      } catch {
        /* non-fatal */
      }
      const res = clearAckEndedSync(cfg.inboxBase, endedId, `peer -> ${target}: ${rawMsg}`);
      if (!res.ok) {
        console.error(`WARN: peer sent but --ended failed: ${res.error ?? "?"}`);
        return;
      }
      console.log(`ok ended ack=${res.id ?? endedId}`);
      const tgt = target.replace(/^slot-/, "").toLowerCase();
      if (
        !redirectFrom &&
        endedFrom &&
        (tgt === "secretary" || tgt.startsWith("secretary"))
      ) {
        await armRedirect(endedFrom, `auto --ended ${endedId} peer→secretary`);
      }
    };
    try {
      const remote = parseRemotePeerTarget(target);
      if (remote) {
        runRemotePeer(loaded, remote.alias, remote.seat, rawMsg);
        await finishEnded();
        if (redirectFrom) await armRedirect(redirectFrom, `peer → ${target}`);
        return;
      }
      // Workers + minis: universal peer (to-slot/to-mini/enqueue). Coords keep manager stamp.
      try {
        runPeer(loaded, target, rawMsg);
        await finishEnded();
        if (redirectFrom) await armRedirect(redirectFrom, `peer → ${target}`);
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
          { manager: true, force: true },
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
      await finishEnded();
      if (redirectFrom) await armRedirect(redirectFrom, `peer → ${target}`);
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
    if (sub === "stop") {
      const reg = createRegistryForProfile(loaded.profile);
      runSwitch(loaded, reg, "secretary", "empty", { reason: "stop" });
      saveMeshSession(loaded, reg);
      console.log("OK: secretary stopped (pane -> empty shell)");
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
        "opencode-cpe",
        "oc-proxy", // legacy alias → normalizeAgentKind → opencode-cpe
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
      runSwitch(loaded, reg, "secretary", typeArg ?? defaultHarnessTypeForSeat(loaded, "secretary"), {
        fresh,
        reason: fresh ? "restart-fresh" : "restart",
      });
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

  if (cmd === "kind" && (sub === "list" || sub === "show")) {
    const loaded = meshLoaded(profileArg);
    const kinds = kindsForLoaded(loaded);
    if (sub === "list") {
      for (const id of Object.keys(kinds).sort()) {
        const k = kinds[id]!;
        const launch =
          k.launch === undefined
            ? "default"
            : k.launch === null
              ? "empty"
              : "builtin" in k.launch
                ? `builtin:${k.launch.builtin}`
                : `script:${k.launch.command}`;
        const aliases = k.aliases?.length ? ` aliases=${k.aliases.join(",")}` : "";
        console.log(`${id}\tprovider=${k.provider}\tlaunch=${launch}${aliases}`);
      }
      return;
    }
    const id = tail[0];
    if (!id) {
      console.error("usage: kind show <id>");
      process.exit(2);
    }
    const found = lookupResolvedKind(kinds, id);
    if (!found) {
      console.error(`kind show: unknown kind "${id}" (see: seatmesh kind list)`);
      process.exit(1);
    }
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  if (cmd === "kind" || cmd === "what" || cmd === "typeof") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const args = [sub, ...tail].filter((a): a is string => Boolean(a));
    const json = args.includes("--json");
    const target = args.find((a) => a !== "--json") ?? "here";
    try {
      runPaneKind(loaded, reg, target, { json });
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

  if (cmd === "capture") {
    const loaded = meshLoaded(profileArg);
    try {
      runPaneCapture(loaded, [sub, ...tail].filter((a): a is string => Boolean(a)));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "pane") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const action = sub ?? "help";
    if (action === "help" || action === "-h" || action === "--help") {
      console.log(`pane — pane helpers (operator)

  pane resume [target]     autodetect session id on pane → resume / relaunch
  Targets: here (default) | secretary | manager | slot-N | mini-N

  Live OpenCode: pastes resume [ses_…]
  Shell / dead OC: relaunches opencode-cpe|opencode|claude with that session`);
      return;
    }
    if (action === "resume") {
      requireCoordRole(loaded, "pane resume");
      const target = tail.find((t) => !t.startsWith("-")) ?? "here";
      try {
        const r = runPaneResume(loaded, reg, target);
        if (!r.ok) {
          console.error(`FAIL: pane resume ${r.target} pane=${r.paneId}: ${r.detail}`);
          process.exit(1);
        }
        console.log(
          `OK: pane resume ${r.mode} ${r.target} pane=${r.paneId} session=${r.sessionId} ${r.harnessType} — ${r.detail}`,
        );
        if (r.mode === "relaunch") saveMeshSession(loaded, reg);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
      return;
    }
    console.error(`usage: pane resume [target]\n  unknown: pane ${action}`);
    process.exit(2);
  }

  if (cmd === "ppa") {
    const loaded = meshLoaded(profileArg);
    const reg = createRegistryForProfile(loaded.profile);
    const args = [sub, ...tail].filter((a): a is string => Boolean(a));
    const raw = args.includes("--raw") || args.includes("perf-index") || args.includes("index");
    const idleIdx = args.findIndex((a) => a === "--idle" || a === "--idle-sec");
    const idleSec =
      idleIdx >= 0 && args[idleIdx + 1] ? Number.parseInt(args[idleIdx + 1]!, 10) : undefined;
    if (args.some((a) => a === "-h" || a === "--help" || a === "help")) {
      const { printCmdHelp } = await import("./commands/help-text.js");
      printCmdHelp("ppa");
      return;
    }
    try {
      runPpa(loaded, reg, {
        raw,
        idleSec: idleSec != null && Number.isFinite(idleSec) ? idleSec : undefined,
      });
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

  if (cmd === "hub" || cmd === "get") {
    const loaded = meshLoaded(profileArg);
    await runAgentHub(loaded, [sub, ...tail].filter((x): x is string => x != null && x !== ""));
    return;
  }

  // Discoverable aliases — no literal "read-history" existed; map to chat + room tip.
  if (cmd === "read-history" || cmd === "history" || cmd === "readhistory") {
    const loaded = meshLoaded(profileArg);
    const extra = [sub, ...tail].filter((x): x is string => x != null && x !== "");
    await runAgentHub(loaded, ["chat", ...extra]);
    console.log("also: seatmesh agent room tail [-r slug] [-n N]  ·  hub room");
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

  if (cmd === "todo" || cmd === "todos") {
    const loaded = meshLoaded(profileArg);
    runSeatCommand(loaded, ["task", ...(sub ? [sub, ...tail] : tail)]);
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
    const launchNow = rawArgs.includes("--now") || rawArgs.includes("--fast");
    const targetsRaw = rawArgs.filter((a) => a !== "--now" && a !== "--fast");
    const rangeOpts = targetRangeOptsFromProfile(loaded.profile);
    const targets = targetsRaw.length
      ? targetsRaw.flatMap((t) => expandTargetSpec(t, rangeOpts))
      : undefined;
    const label = targets?.length ? targets.join(",") : "all";
    const runLaunch = () => {
      const results = launchSession(loaded, {
        targets,
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
      { targets },
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
    console.log(
      'hint: prefer `todo give` (work) or `ask`/`msg`/`peer` (comms) over bare `prompt`',
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

  if (cmd === "kill" || cmd === "empty") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "switch");
    const targetRaw = sub;
    if (!targetRaw) {
      console.error(`usage: ${cmd} <target|1..4|slot-N|mini-N|here>`);
      console.error("  → plain terminal (respawn-pane -k) + save empty in mesh-agents.json");
      process.exit(2);
    }
    const targets = expandTargetSpec(
      targetRaw,
      targetRangeOptsFromProfile(loaded.profile),
    );
    for (const t of targets) {
      runSwitchFast(loaded, t, "empty", {
        fresh: true,
        persistEmpty: true,
        reason: cmd === "kill" ? "kill" : "empty",
      });
    }
    if (targets.length > 1) {
      console.log(`ok fanout ${cmd} → ${targets.join(",")} (${targets.length})`);
    }
    return;
  }

  if (cmd === "switch" || cmd === "handoff" || cmd === "spawn") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, cmd === "spawn" ? "switch" : cmd);
    const args = [sub, ...tail].filter(Boolean);
    const vocal = cmd === "spawn" ? "spawn" : "switch";
    // spawn defaults fast (paste like typing opencode); switch defaults thorough
    let fast = cmd === "spawn";
    if (args.length < 2) {
      console.error(
        cmd === "spawn"
          ? "usage: spawn <target|1..4> <agent|cursor|claude|oc|opencode> [--fast|--slow] [--keep-resume] [--resume ID]"
          : "usage: switch <target|1..4> <agent|…|empty> [--fast|--slow] [--keep-resume] [--resume ID] [reason...]",
      );
      console.error(
        "  empty→CLI: spawn (fast by default) · replace live: switch · --fast = skip verify waits",
      );
      process.exit(2);
    }
    const targetRaw = args[0]!;
    const newType = args[1]!;
    let fresh: boolean | undefined;
    let queue = false;
    let resumeId: string | undefined;
    const reasonParts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const a = args[i]!;
      if (a === "--fresh") fresh = true;
      else if (a === "--keep-resume" || a === "--no-fresh") fresh = false;
      else if (a === "--fast") fast = true;
      else if (a === "--slow" || a === "--verify") fast = false;
      else if (a === "--queue") queue = true;
      else if (a === "--resume" && args[i + 1]) resumeId = args[++i];
      else if (a.startsWith("--resume=")) resumeId = a.slice("--resume=".length);
      else reasonParts.push(a);
    }
    const reason = reasonParts.join(" ") || undefined;
    const targets = expandTargetSpec(
      targetRaw,
      targetRangeOptsFromProfile(loaded.profile),
    );
    // Fast path skips provider registry build (expensive).
    const reg = fast ? null : createRegistryForProfile(loaded.profile);
    const runOne = (target: string) =>
      runSwitch(loaded, reg, target, newType, {
        fresh,
        resumeId,
        reason,
        fast,
      });
    const run = () => {
      for (const t of targets) runOne(t);
      if (targets.length > 1) {
        console.log(`ok fanout ${vocal} → ${targets.join(",")} (${targets.length})`);
      }
    };
    if (queue) {
      submitPaneOp(
        loaded,
        "switch",
        { target: targetRaw, newType, fresh, resumeId, reason, fast },
        `${vocal} ${targetRaw} -> ${newType}${fast ? " [fast]" : ""}`,
        run,
      );
    } else {
      run();
      if (!fast && reg) saveMeshSession(loaded, reg);
    }
    return;
  }

  if (cmd === "swap") {
    const loaded = meshLoaded(profileArg);
    requireCoordRole(loaded, "swap");
    const a = sub;
    const b = tail.find((t) => !t.startsWith("-"));
    if (!a || !b) {
      console.error(
        "usage: swap <slot-A|mini-A> <slot-B|mini-B> [--identity]\n" +
          "  default: visual tmux swap-pane (session data stays with each agent)\n" +
          "  --identity: exchange numbers + seat dirs + mesh-agents (peer addresses swap)",
      );
      process.exit(2);
    }
    const identity = tail.includes("--identity");
    try {
      const result = runSeatSwap(loaded, a, b, { identity });
      console.log(
        `OK: swap ${result.mode} ${result.a} ↔ ${result.b} (${result.paneA} ↔ ${result.paneB})`,
      );
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
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

    // agent help / agent --help — never UNAUTHORIZED; teach the card + per-cmd usage.
    if (
      !sub ||
      sub === "help" ||
      sub === "-h" ||
      sub === "--help"
    ) {
      if (sub === "help" && tail[0] && !tail[0].startsWith("-")) {
        const { printCmdHelp } = await import("./commands/help-text.js");
        if (!printCmdHelp(tail[0])) process.exit(2);
        return;
      }
      if (sub === "help" || sub === "-h" || sub === "--help") {
        const { printAgentHelpIndex } = await import("./commands/help-text.js");
        printAgentHelpIndex();
        const w = runWhoami(loaded, "here");
        printAgentCard(w);
        return;
      }
      // bare `agent` — card only (+ one help hint)
      const w = runWhoami(loaded, "here");
      printAgentCard(w);
      console.log("help=seatmesh agent help <cmd>  # usage for one verb");
      return;
    }

    if (sub && AGENT_META.has(sub)) {
      if (sub === "forum" || sub === "golf") {
        const { printAgentForum } = await import("./commands/agent-forum.js");
        printAgentForum();
        return;
      }
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
    }

    // Gateway: agent <cmd> … → authz then re-enter as top-level <cmd>
    if (sub && !AGENT_META.has(sub)) {
      const decision = assertAgentDispatch(loaded, sub, tail);
      if (decision.kind === "card-target") {
        const w = runWhoami(loaded, decision.target);
        printAgentCard(w);
        return;
      }
      if (decision.kind !== "allow") {
        printAgentUnauthorized(decision);
        process.exit(2);
      }
      process.env.SEATMESH_AGENT_GATEWAY = "1";
      process.argv = stripAgentFromArgv(process.argv);
      return main();
    }

    // Bare `agent` — own card
    const w = runWhoami(loaded, "here");
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
      console.error("hint: seatmesh --profile .sm agent");
      process.exit(2);
    }
    try {
      const w = runWhoami(loaded, "here");
      const kind = roleKindFromWhoami(w.role);
      const paths = profilePaths(loaded);
      const index = loadRoleIndex(paths.rolesDir, kind);
      if (!roleAllows(index.funcs, id)) {
        console.error(`UNAUTHORIZED: func ${id} denied for role=${kind}`);
        console.error("hint: seatmesh --profile .sm agent");
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
      console.error("note: where is deprecated — use seatmesh --profile .sm agent whoami");
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
      const script = path.join(loaded.workspace, "scripts/opencode-cpe-reset.sh");
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
    const path = await import("node:path");
    const dropIn = await loadDropInProviders(
      path.join(loaded.profileDir, "providers"),
      (line) => console.error(line),
    );
    for (const p of dropIn.providers) reg.register(p);
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
        const role = snap.options.mesh_role?.trim() || "plain";
        const slot = snap.options.mesh_slot || "-";
        const ports = snap.options.mesh_ports || "-";
        console.log(
          `${paneId}\trole=${role}\t${prov?.id ?? "?"}\t${det?.resumeId ?? "-"}\t${state.phase}${state.limitKind ? `:${state.limitKind}` : ""}\tslot=${slot}\tports=${ports}\t${snap.windowName}`,
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
        ? (await import("./commands/room-cli.js")).buildRoomCommands(getLoaded)
        : cmd === "contract"
          ? (await import("./commands/contract-lock-cli.js")).buildContractLockCommands(getLoaded)
          : (await import("./commands/chat-cli.js")).buildChatCommands(getLoaded);
    // contract with no sub → status (simple agent path)
    if (!sub && cmd === "contract") {
      try {
        await branch.parseAsync(["status"], { from: "user" });
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
        throw e;
      }
      return;
    }
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

  if (cmd === "checkback" || cmd === "patience" || cmd === "cb") {
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

  if (cmd === "target" || cmd === "targets") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildTargetCommands(getLoaded);
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

  if (cmd === "ack") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildAckCommands(getLoaded);
    try {
      await branch.parseAsync(rest.slice(1), { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "limit") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = buildLimitCommands(getLoaded);
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
    const branch = (await import("./commands/notify-cli.js")).buildNotifyCommand(getLoaded);
    try {
      await branch.parseAsync(rest.slice(1), { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "mds") {
    const loaded = meshLoaded(profileArg);
    const { runMdsCommand } = await import("./commands/mds-cli.js");
    process.exit(await runMdsCommand(loaded, rest.slice(1)));
  }

  if (cmd === "preview") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = (await import("./commands/preview-cli.js")).buildPreviewCommand(getLoaded);
    try {
      await branch.parseAsync(rest.slice(1), { from: "user" });
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return;
      throw e;
    }
    return;
  }

  if (cmd === "nav") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = (await import("./commands/nav-cli.js")).buildNavCommands(getLoaded);
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

  if (cmd === "campaign") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = (await import("./commands/campaign-cli.js")).buildCampaignCommands(getLoaded);
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

  if (cmd === "schedule") {
    const loaded = meshLoaded(profileArg);
    const getLoaded = () => loaded;
    const branch = (await import("./commands/schedule-cli.js")).buildScheduleCommand(getLoaded);
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
  console.error("hint: seatmesh help · seatmesh help human · seatmesh --agents help");
  process.exit(2);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

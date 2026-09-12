import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  findDotSmConfig,
  meshRuntimePaths,
  profilePaths,
  type LoadedProfile,
} from "@seat-mesh/core";
import { snapshotConnectivity, formatStatus } from "@seat-mesh/connectivity";
import {
  inboxHealth,
  meshInboxPort,
  meshInboxStatusLine,
  printVerify,
  tmuxHasSession,
  verifyMeshSession,
} from "@seat-mesh/tmux";
import { printSeatmeshBanner } from "./banner.js";

export interface PrereqRow {
  name: string;
  required: boolean;
  ok: boolean;
  detail: string;
}

function which(bin: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0;
}

function tmuxVersion(): string | null {
  const r = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

function checkPrereqs(loaded: LoadedProfile): PrereqRow[] {
  const rows: PrereqRow[] = [];
  const add = (name: string, required: boolean, ok: boolean, detail: string) => {
    rows.push({ name, required, ok, detail });
  };

  add("tmux", true, which("tmux"), tmuxVersion() ?? "not in PATH");
  add("curl", true, which("curl"), which("curl") ? "ok" : "missing");
  add("git", false, which("git"), which("git") ? "ok" : "not found");

  return rows;
}

function printSection(title: string): void {
  console.log(`\n## ${title}`);
}

function printPrereqs(rows: PrereqRow[]): boolean {
  printSection("Prerequisites");
  let ok = true;
  for (const r of rows) {
    const mark = r.ok ? "PASS" : r.required ? "FAIL" : "WARN";
    if (!r.ok && r.required) ok = false;
    console.log(`${mark}  ${r.name}: ${r.detail}`);
  }
  return ok;
}

function printProfile(loaded: LoadedProfile): void {
  printSection("Profile");
  const paths = profilePaths(loaded);
  const rt = meshRuntimePaths(loaded);
  console.log(`name=${loaded.profile.name}`);
  console.log(`workspace=${loaded.workspace}`);
  console.log(`workspace_id=${loaded.workspaceId}`);
  console.log(`session=${loaded.sessionName}`);
  console.log(`daemon_port=${paths.daemonPort}`);
  console.log(`storage=${rt.storageBackend}${rt.storageBackend === "sqlite" ? ` (${rt.sqlitePath})` : ""}`);
  console.log(`daemon_dir=${rt.daemonDir}`);
  console.log(`seats_root=${paths.seatsRoot}`);
  console.log(`roles_dir=${paths.rolesDir}`);
  console.log(`contracts=${paths.contractsDir ?? "(profile default)"}`);
}

function printSession(loaded: LoadedProfile): boolean {
  printSection("Tmux session");
  const session = loaded.sessionName;
  const exists = tmuxHasSession(session);
  console.log(`session=${session} exists=${exists}`);
  if (!exists) {
    console.log("  next: npx seatmesh session up");
    return false;
  }
  const issues = verifyMeshSession(loaded);
  printVerify(issues);
  return issues.every((i) => i.level !== "error");
}

function printInbox(loaded: LoadedProfile): { ok: boolean; health: Record<string, unknown> | null } {
  printSection("Inbox daemon");
  const port = meshInboxPort(loaded);
  const h = inboxHealth(port);
  let ok = Boolean(h && h.engine === "@seat-mesh/daemon");
  console.log(meshInboxStatusLine(loaded, h));
  if (ok && h) {
    const daemonSession = String(h.session ?? "");
    if (daemonSession && daemonSession !== loaded.sessionName) {
      console.log(
        `  WARN: daemon session=${daemonSession} != profile session=${loaded.sessionName} (stale listener?)`,
      );
      ok = false;
    }
    if (h.stateDir) console.log(`  state_dir=${String(h.stateDir)}`);
    if (h.supervisorPid) console.log(`  supervisor_pid=${String(h.supervisorPid)}`);
    if (h.uptimeSec != null) console.log(`  uptime_sec=${String(h.uptimeSec)}`);
    if (h.peerUnsent != null) console.log(`  peer_unsent=${String(h.peerUnsent)}`);
    if (h.inboxUnresolved != null) console.log(`  inbox_unresolved=${String(h.inboxUnresolved)}`);
    if (h.checkbackActive != null) console.log(`  checkback_active=${String(h.checkbackActive)}`);
    if (h.ocLimitActive != null && Number(h.ocLimitActive) > 0) {
      console.log(`  oc_limit_active=${String(h.ocLimitActive)}`);
    }
    if (!ok) {
      console.log(`  fix: npx seatmesh inbox restart   (or session up / reload)`);
    }
  } else {
    const rt = meshRuntimePaths(loaded);
    console.log(`  fix: npx seatmesh inbox start   (or session up / reload)`);
    if (fs.existsSync(rt.meshInboxLog)) console.log(`  log: ${rt.meshInboxLog}`);
  }
  return { ok, health: h };
}

function printPaneOps(h: Record<string, unknown> | null): void {
  printSection("Pane ops queue");
  if (!h || h.engine !== "@seat-mesh/daemon") {
    console.log("pending=? (inbox down)");
    return;
  }
  const pending = h.paneOpsPending ?? h.pane_ops_pending;
  console.log(`pending=${pending != null ? String(pending) : "?"}`);
}

async function printConnectivity(loaded: LoadedProfile): Promise<void> {
  const conn = loaded.profile.connectivity;
  if (!conn?.enabled) {
    printSection("Connectivity");
    console.log("disabled in profile");
    return;
  }
  printSection("Connectivity");
  const snap = await snapshotConnectivity(loaded.profile);
  console.log(formatStatus(snap));
}

function printInTmux(): void {
  printSection("This shell");
  const pane = process.env.TMUX_PANE;
  if (pane) {
    console.log(`in_tmux=yes pane=${pane}`);
  } else {
    console.log("in_tmux=no (attach: npx seatmesh session attach)");
  }
}

export interface StatusReportOptions {
  json?: boolean;
}

export interface StatusReport {
  ok: boolean;
  prereqs: PrereqRow[];
  sessionOk: boolean;
  inboxOk: boolean;
  layoutOk: boolean;
}

/** Full stack status — default when `npx seatmesh` runs with no subcommand. */
export async function printStatusReport(
  loaded: LoadedProfile,
  opts: StatusReportOptions = {},
): Promise<StatusReport> {
  const prereqs = checkPrereqs(loaded);
  const prereqOk = prereqs.filter((r) => r.required).every((r) => r.ok);
  const sessionOk = tmuxHasSession(loaded.sessionName);
  const port = meshInboxPort(loaded);
  const h0 = inboxHealth(port);
  const inboxOk =
    Boolean(h0 && h0.engine === "@seat-mesh/daemon") &&
    String(h0?.session ?? loaded.sessionName) === loaded.sessionName;
  const layoutIssues = sessionOk ? verifyMeshSession(loaded) : [];
  const layoutOk = layoutIssues.every((i) => i.level !== "error");

  const report: StatusReport = {
    ok: prereqOk && inboxOk && (!sessionOk || layoutOk),
    prereqs,
    sessionOk,
    inboxOk,
    layoutOk,
  };

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          profile: loaded.profile.name,
          workspace: loaded.workspace,
          session: loaded.sessionName,
          daemon_port: port,
          inbox: h0 ?? null,
          layout_issues: layoutIssues,
        },
        null,
        2,
      ),
    );
    return report;
  }

  const projectCfg = findDotSmConfig(process.cwd());
  printSeatmeshBanner({
    subtitle: `status  profile=${loaded.profile.name}  session=${loaded.sessionName}`,
    tagline: !projectCfg,
  });
  if (!projectCfg) {
    const { terminalBold } = await import("./logo-color.js");
    console.log("seatmesh is not initialized on this project");
    console.log(terminalBold("npx seatmesh init"));
  }
  const pOk = printPrereqs(prereqs);
  printProfile(loaded);
  printInTmux();
  const sOk = printSession(loaded);
  const inbox = printInbox(loaded);
  printPaneOps(inbox.health);
  await printConnectivity(loaded);

  printSection("Summary");
  const marks = [
    ["prereqs", pOk],
    ["session", sOk],
    ["inbox", inbox.ok],
    ["layout", !sessionOk || layoutOk],
  ] as const;
  for (const [k, v] of marks) {
    console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
  }
  report.ok = pOk && inbox.ok && (!sessionOk || layoutOk);
  if (!report.ok) {
    console.log("\nHint: npx seatmesh init  ->  session up  ->  inbox (auto on reload)");
  } else {
    console.log("\nOK: stack ready");
  }
  return report;
}

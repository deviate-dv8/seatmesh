/**
 * session check / session repair — config, version stamp, and lost runtime files.
 * Agents sometimes delete daemon/seat files; repair only recreates missing paths
 * (never overwrites live FOCUS/TASKS or non-empty ledgers).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildResolvedPaths,
  meshRuntimePaths,
  seatDirSegment,
  writePathsManifest,
  type LoadedProfile,
} from "@seat-mesh/core";
import { ensureSeatFiles, ensureMeshInbox, sessionSync } from "@seat-mesh/tmux";
import {
  readInstalledCliVersion,
  readProfileSeatmeshVersion,
  semverLess,
} from "../ui/version-nudge.js";
import { ensureAgentsCliDoc, ensureMissingRoleTemplates } from "./init.js";
import { mergeMeshConfigOnUpdate } from "./merge-mesh-config.js";

export type HealthSeverity = "ok" | "warn" | "fail";

export interface HealthFinding {
  id: string;
  severity: HealthSeverity;
  /** Workspace- or profile-relative path when applicable. */
  path?: string;
  message: string;
  /** repair can fix this finding. */
  repairable: boolean;
}

export interface SessionCheckResult {
  ok: boolean;
  findings: HealthFinding[];
  cliVersion: string;
  profileVersion: string | null;
  profileDir: string;
  sessionName: string;
}

export interface SessionRepairResult {
  check: SessionCheckResult;
  repaired: string[];
  skipped: string[];
  inboxEnsured: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.join(__dirname, "..", "..", "templates", "init");

function rel(workspace: string, abs: string): string {
  const r = path.relative(workspace, abs);
  return r && !r.startsWith("..") ? r : abs;
}

function missing(abs: string): boolean {
  return !fs.existsSync(abs);
}

function isEmptyFile(abs: string): boolean {
  if (!fs.existsSync(abs)) return true;
  try {
    return fs.statSync(abs).size === 0;
  } catch {
    return true;
  }
}

/** Critical profile files that should always exist after init/update. */
function profileCriticalFiles(loaded: LoadedProfile): { id: string; abs: string; label: string }[] {
  const d = loaded.profileDir;
  const resolved = buildResolvedPaths(loaded);
  return [
    { id: "config", abs: loaded.profilePath, label: "mesh.config.yaml" },
    { id: "mesh-agents", abs: resolved.meshAgentsJson, label: "mesh-agents.json" },
    { id: "agents-md", abs: path.join(d, "AGENTS.md"), label: "AGENTS.md" },
    { id: "paths-json", abs: path.join(d, "paths.json"), label: "paths.json" },
    { id: "roles-dir", abs: resolved.rolesDir, label: "roles/" },
    {
      id: "role-pack",
      abs: path.join(resolved.rolesDir, "_vendor", "ROLE_PACK.json"),
      label: "roles/_vendor/ROLE_PACK.json",
    },
  ];
}

/** Runtime dirs that must exist for the daemon. */
function runtimeDirs(loaded: LoadedProfile): { id: string; abs: string; label: string }[] {
  const p = buildResolvedPaths(loaded);
  return [
    { id: "dir-data", abs: p.dataRoot, label: "runtime/" },
    { id: "dir-daemon", abs: p.daemonDir, label: "runtime/daemon/" },
    { id: "dir-seats", abs: p.seatsRoot, label: "seats/" },
    { id: "dir-chat", abs: p.chatRoomsRoot, label: "chat-rooms/" },
    { id: "dir-contracts", abs: p.contractsDir, label: "contracts/" },
  ];
}

/**
 * Daemon ledgers — missing is OK for a fresh session (daemon recreates on write),
 * but after agents delete them mid-flight we restore empty files so appends work
 * and operators see what was lost.
 */
function daemonLedgerFiles(loaded: LoadedProfile): { id: string; abs: string; empty: string }[] {
  const rt = meshRuntimePaths(loaded);
  const daemonDir = rt.daemonDir;
  return [
    { id: "ledger-inbox", abs: rt.inboxJsonl, empty: "" },
    { id: "ledger-peer", abs: rt.peerJsonl, empty: "" },
    { id: "ledger-checkback", abs: rt.checkbackJsonl, empty: "" },
    { id: "ledger-ack", abs: rt.ackJsonl, empty: "" },
    { id: "ledger-target", abs: rt.targetJsonl, empty: "" },
    { id: "ledger-pane-ops", abs: rt.paneOpsJsonl, empty: "" },
    { id: "ledger-calls", abs: rt.callsJsonl, empty: "" },
    { id: "ledger-peer-backlog", abs: path.join(daemonDir, "PEER-BACKLOG.jsonl"), empty: "" },
    {
      id: "ack-redirect",
      abs: path.join(daemonDir, "ACK-REDIRECT-BLOCKS.json"),
      empty: "[]\n",
    },
    { id: "cold-start", abs: rt.coldStartState, empty: "{}\n" },
    { id: "ppa-state", abs: rt.ppaState, empty: "{}\n" },
  ];
}

function seatTrioMissing(loaded: LoadedProfile): string[] {
  const root = buildResolvedPaths(loaded).seatsRoot;
  const dirs = loaded.profile.seats.dirs;
  const missingPaths: string[] = [];
  const check = (dir: string) => {
    for (const name of ["FOCUS.md", "TASKS.md", "REMINDER.md"]) {
      const p = path.join(dir, name);
      if (missing(p)) missingPaths.push(p);
    }
  };
  for (const col of loaded.profile.layout?.base.columns ?? ["manager", "secretary"]) {
    check(path.join(root, seatDirSegment(dirs, col)));
  }
  const workerPat = dirs?.worker ?? "slot-{n}";
  for (let n = 1; n <= loaded.profile.session.workerCount; n++) {
    check(path.join(root, workerPat.replace("{n}", String(n))));
  }
  return missingPaths;
}

export function runSessionCheck(loaded: LoadedProfile): SessionCheckResult {
  const findings: HealthFinding[] = [];
  const ws = loaded.workspace;
  const cliVersion = readInstalledCliVersion();
  const profileVersion = readProfileSeatmeshVersion(loaded.profileDir);

  // Config already loaded if we got here — still record ok.
  findings.push({
    id: "config-load",
    severity: "ok",
    path: rel(ws, loaded.profilePath),
    message: `config loads (session=${loaded.sessionName})`,
    repairable: false,
  });

  if (!profileVersion) {
    findings.push({
      id: "version-stamp",
      severity: "warn",
      path: rel(ws, path.join(loaded.profileDir, ".seatmesh-version")),
      message: `profile has no .seatmesh-version (CLI ${cliVersion}) — run session repair or update`,
      repairable: true,
    });
  } else if (profileVersion !== cliVersion) {
    const behind = semverLess(profileVersion, cliVersion);
    findings.push({
      id: "version-mismatch",
      severity: behind ? "warn" : "ok",
      path: rel(ws, path.join(loaded.profileDir, ".seatmesh-version")),
      message: behind
        ? `profile stamp ${profileVersion} behind CLI ${cliVersion} — run seatmesh update`
        : `profile stamp ${profileVersion} (CLI ${cliVersion})`,
      repairable: behind,
    });
  } else {
    findings.push({
      id: "version",
      severity: "ok",
      message: `CLI ${cliVersion} matches profile stamp`,
      repairable: false,
    });
  }

  for (const f of profileCriticalFiles(loaded)) {
    if (missing(f.abs)) {
      findings.push({
        id: f.id,
        severity: f.id === "config" ? "fail" : "fail",
        path: rel(ws, f.abs),
        message: `missing ${f.label}`,
        repairable: f.id !== "config",
      });
    } else {
      findings.push({
        id: f.id,
        severity: "ok",
        path: rel(ws, f.abs),
        message: `${f.label} present`,
        repairable: false,
      });
    }
  }

  for (const d of runtimeDirs(loaded)) {
    if (missing(d.abs) || !fs.statSync(d.abs).isDirectory()) {
      findings.push({
        id: d.id,
        severity: "fail",
        path: rel(ws, d.abs),
        message: `missing dir ${d.label}`,
        repairable: true,
      });
    }
  }

  const rt = meshRuntimePaths(loaded);
  if (missing(rt.gateQueue)) {
    findings.push({
      id: "gate-queue",
      severity: "fail",
      path: rel(ws, rt.gateQueue),
      message: "missing GATE-QUEUE.md",
      repairable: true,
    });
  }

  const seatMiss = seatTrioMissing(loaded);
  if (seatMiss.length) {
    findings.push({
      id: "seats",
      severity: "fail",
      message: `${seatMiss.length} seat file(s) missing (FOCUS/TASKS/REMINDER)`,
      repairable: true,
    });
    for (const p of seatMiss.slice(0, 12)) {
      findings.push({
        id: `seat:${rel(ws, p)}`,
        severity: "fail",
        path: rel(ws, p),
        message: "missing seat file",
        repairable: true,
      });
    }
    if (seatMiss.length > 12) {
      findings.push({
        id: "seats-more",
        severity: "fail",
        message: `… and ${seatMiss.length - 12} more seat files`,
        repairable: true,
      });
    }
  } else {
    findings.push({
      id: "seats",
      severity: "ok",
      message: "seat FOCUS/TASKS/REMINDER present for configured columns/slots",
      repairable: false,
    });
  }

  const ledgers = daemonLedgerFiles(loaded);
  const daemonTouched =
    !missing(rt.meshInboxMeta) ||
    !missing(rt.meshInboxLog) ||
    ledgers.some((L) => !missing(L.abs));

  let missingLedgers = 0;
  if (daemonTouched) {
    for (const L of ledgers) {
      if (missing(L.abs)) {
        missingLedgers++;
        findings.push({
          id: L.id,
          severity: "warn",
          path: rel(ws, L.abs),
          message: "daemon file missing (likely deleted) — repair recreates empty",
          repairable: true,
        });
      }
    }
  }
  if (missingLedgers === 0) {
    findings.push({
      id: "daemon-ledgers",
      severity: "ok",
      message: daemonTouched
        ? "daemon ledger files present"
        : "daemon ledgers not started yet (ok)",
      repairable: false,
    });
  }

  if (rt.storageBackend === "sqlite" && missing(rt.sqlitePath)) {
    findings.push({
      id: "sqlite",
      severity: "warn",
      path: rel(ws, rt.sqlitePath),
      message: "mesh.sqlite missing — inbox will recreate on next start",
      repairable: true,
    });
  }

  if (missing(rt.meshInboxMeta)) {
    findings.push({
      id: "inbox-meta",
      severity: "warn",
      path: rel(ws, rt.meshInboxMeta),
      message: "mesh-inbox.json missing — repair ensures inbox",
      repairable: true,
    });
  }

  const ok = !findings.some((f) => f.severity === "fail");
  return {
    ok,
    findings,
    cliVersion,
    profileVersion,
    profileDir: loaded.profileDir,
    sessionName: loaded.sessionName,
  };
}

function writeIfMissing(abs: string, contents: string, repaired: string[]): boolean {
  if (fs.existsSync(abs)) return false;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, "utf8");
  repaired.push(abs);
  return true;
}

function restoreMeshAgents(loaded: LoadedProfile, repaired: string[]): void {
  const dest = buildResolvedPaths(loaded).meshAgentsJson;
  if (fs.existsSync(dest)) return;
  const src = path.join(TEMPLATE_ROOT, "mesh-agents.json");
  if (!fs.existsSync(src)) return;
  const workdir = loaded.workspace;
  const body = fs
    .readFileSync(src, "utf8")
    .replace(/\{\{workdir\}\}/g, workdir)
    .replace(/\{\{name\}\}/g, loaded.profile.name ?? path.basename(workdir));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body, "utf8");
  repaired.push(dest);
}

function ensureRuntimeDirsRepair(loaded: LoadedProfile, repaired: string[]): void {
  const paths = buildResolvedPaths(loaded);
  for (const dir of [
    paths.dataRoot,
    paths.daemonDir,
    paths.chatRoomsRoot,
    paths.seatsRoot,
    paths.contractsDir,
    path.join(paths.contractsDir, "locks"),
  ]) {
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    repaired.push(dir);
  }
}

export function runSessionRepair(
  loaded: LoadedProfile,
  opts: { sync?: boolean; skipInbox?: boolean } = {},
): SessionRepairResult {
  const repaired: string[] = [];
  const skipped: string[] = [];

  ensureRuntimeDirsRepair(loaded, repaired);

  const agents = ensureAgentsCliDoc(loaded.profileDir, {
    workspace: loaded.workspace,
    forceRefresh: false,
  });
  for (const p of [...agents.created, ...agents.refreshed]) repaired.push(p);

  const roles = ensureMissingRoleTemplates(loaded.profileDir);
  for (const p of roles.created) repaired.push(p);

  restoreMeshAgents(loaded, repaired);

  const pathsJson = path.join(loaded.profileDir, "paths.json");
  const pathsWasMissing = missing(pathsJson);
  writePathsManifest(loaded);
  if (pathsWasMissing) repaired.push(pathsJson);

  const seats = ensureSeatFiles(loaded);
  for (const p of seats.created) repaired.push(p);

  for (const L of daemonLedgerFiles(loaded)) {
    writeIfMissing(L.abs, L.empty, repaired);
  }

  const rt = meshRuntimePaths(loaded);
  // sqlite: touch empty is useless; leave for inbox. Ensure parent dir only.
  if (rt.storageBackend === "sqlite" && missing(rt.sqlitePath)) {
    skipped.push(`${rt.sqlitePath} (recreated by inbox on start)`);
  }

  const stampPath = path.join(loaded.profileDir, ".seatmesh-version");
  if (missing(stampPath) || isEmptyFile(stampPath)) {
    fs.writeFileSync(stampPath, `${readInstalledCliVersion()}\n`, "utf8");
    repaired.push(stampPath);
  }

  const merge = mergeMeshConfigOnUpdate(loaded, false);
  for (const key of merge.added) {
    repaired.push(`${loaded.profilePath}#${key}`);
  }

  let inboxEnsured = false;
  if (!opts.skipInbox) {
    inboxEnsured = Boolean(ensureMeshInbox(loaded, { quiet: true }));
  }

  if (opts.sync !== false) {
    try {
      sessionSync(loaded);
      repaired.push("session-sync");
    } catch {
      skipped.push("session-sync (failed — session may be down)");
    }
  }

  const check = runSessionCheck(loaded);
  return { check, repaired: [...new Set(repaired)], skipped, inboxEnsured };
}

export function printSessionCheck(result: SessionCheckResult): void {
  const fails = result.findings.filter((f) => f.severity === "fail");
  const warns = result.findings.filter((f) => f.severity === "warn");
  const oks = result.findings.filter((f) => f.severity === "ok");

  console.log(
    `session check  ${result.ok ? "OK" : "FAIL"}  session=${result.sessionName}  cli=${result.cliVersion}  profile=${result.profileVersion ?? "(none)"}`,
  );
  console.log(`  profile: ${result.profileDir}`);

  for (const f of [...fails, ...warns]) {
    const tag = f.severity.toUpperCase();
    const loc = f.path ? `  ${f.path}` : "";
    console.log(`  [${tag}] ${f.message}${loc}`);
  }
  if (fails.length === 0 && warns.length === 0) {
    console.log(`  ${oks.length} checks passed`);
  } else {
    console.log(`  summary: fail=${fails.length} warn=${warns.length} ok=${oks.length}`);
    if (fails.length || warns.some((w) => w.repairable)) {
      console.log(`  fix: seatmesh session repair`);
    }
  }
}

export function printSessionRepair(result: SessionRepairResult): void {
  const { repaired, skipped, inboxEnsured, check } = result;
  console.log(`session repair  session=${check.sessionName}`);
  if (repaired.length) {
    console.log(`  restored ${repaired.length}:`);
    for (const p of repaired.slice(0, 40)) {
      console.log(`    + ${p}`);
    }
    if (repaired.length > 40) console.log(`    … +${repaired.length - 40} more`);
  } else {
    console.log(`  nothing to restore`);
  }
  if (skipped.length) {
    for (const s of skipped) console.log(`  skip: ${s}`);
  }
  console.log(`  inbox: ${inboxEnsured ? "up" : "not ensured / down"}`);
  printSessionCheck(check);
}

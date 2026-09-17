/**
 * OC-LIMIT V2 / OC Restart — notifies + atomics:
 *   1) OC Restart Initialized
 *   2) If no new IP after 30m → node-notifier with Reboot button
 *   3) Same IP after 1st post-reboot wait → silent second CPE reboot
 *   4) Same IP again (2nd time, old=old) → notify, then kill→revive opencode-cpe + CONTINUE
 *   5) Successful new IP → kill CPE OC + revive opencode-cpe + CONTINUE
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  resolveDaemonPort,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import {
  runInboxDesktopNotifySync,
  spawnLinuxActionButtonsToast,
  shouldSkipDesktopNotify,
} from "@seat-mesh/tmux";
import {
  continueOcProxySeats,
  killOcProxySeats,
  recordAllMeshesOcProxySeats,
  reviveOpenCodeCpeSeats,
  type OcCpeAtomicSeat,
} from "./opencode-cpe-atomics.js";
import { syncCarrierIpProbe } from "./oc-resume-broadcast.js";
import { createRegistryForProfile } from "@seat-mesh/providers";

/** Same once-gate as connectivity-recovery (cross-mesh). */
const OC_LIMIT_RECOVERY_STAMP =
  process.env.CPE_OC_LIMIT_RECOVERY_STAMP || "/tmp/seatmesh-oc-limit-recovery.last";

/** Heartbeat while V2 lives in-process — survives sibling checks after SIGKILL. */
const OC_LIMIT_V2_INFLIGHT =
  process.env.CPE_OC_LIMIT_V2_INFLIGHT || "/tmp/seatmesh-oc-v2-inflight.json";

/** If heartbeat is older than this and local episode is gone → orphan stamp (reclaim). */
const OC_V2_INFLIGHT_STALE_MS = Number(process.env.OC_V2_INFLIGHT_STALE_MS || 90_000);

function markRecoveryStamp(nowMs: number = Date.now()): void {
  try {
    fs.writeFileSync(OC_LIMIT_RECOVERY_STAMP, `${Math.floor(nowMs / 1000)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

function clearRecoveryStamp(): void {
  try {
    fs.unlinkSync(OC_LIMIT_RECOVERY_STAMP);
  } catch {
    /* */
  }
}

interface OcV2Inflight {
  pid: number;
  mesh?: string;
  /** reboot | wait-ip | atomics — so a restarted daemon can resume the right step. */
  phase?: "reboot" | "wait-ip" | "atomics";
  startedAt: number;
  heartbeatAt: number;
}

function writeInflight(partial?: Partial<OcV2Inflight>): void {
  const now = Date.now();
  const prev = readInflight();
  const body: OcV2Inflight = {
    pid: process.pid,
    mesh: partial?.mesh ?? prev?.mesh,
    phase: partial?.phase ?? prev?.phase ?? "reboot",
    startedAt: partial?.startedAt ?? prev?.startedAt ?? now,
    heartbeatAt: now,
  };
  try {
    fs.writeFileSync(OC_LIMIT_V2_INFLIGHT, `${JSON.stringify(body)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

function readInflight(): OcV2Inflight | null {
  try {
    const raw = JSON.parse(fs.readFileSync(OC_LIMIT_V2_INFLIGHT, "utf8")) as OcV2Inflight;
    if (!raw || typeof raw.heartbeatAt !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

function clearInflight(): void {
  try {
    fs.unlinkSync(OC_LIMIT_V2_INFLIGHT);
  } catch {
    /* */
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stamp set but no live V2 (daemon SIGKILL mid-reboot) → clear stamp so notify/reset can re-arm.
 * Returns true when stamp was reclaimed.
 */
export function reclaimOrphanOcLimitRecoveryStamp(
  log: (line: string) => void,
  opts?: {
    stampPath?: string;
    inflightPath?: string;
    staleMs?: number;
    nowMs?: number;
  },
): boolean {
  if (ocLimitV2EpisodeActive()) return false;
  const stampPath = opts?.stampPath ?? OC_LIMIT_RECOVERY_STAMP;
  const inflightPath = opts?.inflightPath ?? OC_LIMIT_V2_INFLIGHT;
  const staleMs = opts?.staleMs ?? OC_V2_INFLIGHT_STALE_MS;
  const now = opts?.nowMs ?? Date.now();
  const inflight = readInflightAt(inflightPath);
  if (inflight) {
    const hbAge = now - inflight.heartbeatAt;
    const alive = pidAlive(inflight.pid);
    if (alive && hbAge < staleMs) return false;
    // Owner pid dead or heartbeat stale → orphan
    clearPath(inflightPath);
    clearPath(stampPath);
    log(
      `OC-V2 orphan reclaim — inflight pid=${inflight.pid} alive=${alive} hbAgeMs=${hbAge} (stamp cleared)`,
    );
    return true;
  }
  // Stamp without inflight (pre-inflight builds / crash before write): reclaim if stamp age ≥ 60s
  try {
    const last = Number(fs.readFileSync(stampPath, "utf8").trim()) || 0;
    if (!last) return false;
    const ageSec = Math.floor(now / 1000) - last;
    if (ageSec < 60) return false;
    clearPath(stampPath);
    log(`OC-V2 orphan reclaim — stamp age=${ageSec}s with no inflight (stamp cleared)`);
    return true;
  } catch {
    return false;
  }
}

function clearPath(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    /* */
  }
}

function readInflightAt(inflightPath: string): OcV2Inflight | null {
  try {
    const raw = JSON.parse(fs.readFileSync(inflightPath, "utf8")) as OcV2Inflight;
    if (!raw || typeof raw.heartbeatAt !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

/** Stuck toast after this long without a new carrier IP (override with OC_RESTART_STUCK_MS). */
export const OC_RESTART_STUCK_MS = Number(process.env.OC_RESTART_STUCK_MS || 30 * 60 * 1000);
const IP_POLL_MS = Number(process.env.OC_IP_POLL_MS || 15_000);
const CONTINUE_WAIT_MS = 8_000;

/** How long after reboot completes to wait for a new IP before treating as same-IP. */
const POST_REBOOT_SAME_IP_MS = Number(process.env.OC_SAME_IP_WAIT_MS || 5 * 60 * 1000);

/** Dry prove: no real CPE reboot; finishWithAtomics notifies only (no kill/revive). */
function ocV2Dry(): boolean {
  return process.env.OC_V2_DRY === "1" || process.env.CPE_REBOOT_DRY === "1";
}

function fmtIp(ip: string | null | undefined): string {
  const t = typeof ip === "string" ? ip.trim() : "";
  return t.length > 0 ? t : "?";
}

/** Null/blank never counts as "same IP" — need two concrete equal addresses. */
function sameCarrierIp(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = typeof a === "string" ? a.trim() : "";
  const bb = typeof b === "string" ? b.trim() : "";
  if (!aa || !bb) return false;
  return aa === bb;
}

export interface OcLimitV2Episode {
  workspace: string;
  proxyPort: number;
  inboxPort: number;
  fromIp: string | null;
  startedAt: number;
  lastStuckAt: number;
  /** Epoch ms when the initial CPE reboot cycle completed (set by runCpeRebootAsync callback). */
  rebootCompletedAt: number | null;
  /**
   * How many times we observed same IP after a completed reboot wait.
   * 1 → silent second reboot; 2+ → notify + atomics.
   */
  sameIpAfterRebootCount: number;
  seats: OcCpeAtomicSeat[];
  rebootRunning: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  finished: boolean;
}

let active: OcLimitV2Episode | null = null;
let lastCtx: OcLimitV2StartInput | null = null;

export function ocLimitV2EpisodeActive(): boolean {
  return Boolean(active && !active.finished);
}

function resolveAtomicsRunner(workspace: string): string | null {
  let dir = workspace;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, "scripts", "opencode-cpe-atomics.mjs");
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const homeCand = path.join(
    process.env.HOME || "",
    "Desktop/Projects/seatmesh/scripts/opencode-cpe-atomics.mjs",
  );
  return fs.existsSync(homeCand) ? homeCand : null;
}

function resolveCpeRebootScript(workspace: string): string | null {
  let dir = workspace;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, "scripts", "cpe-reboot.sh");
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const homeCand = path.join(
    process.env.HOME || "",
    "Desktop/Projects/seatmesh/scripts/cpe-reboot.sh",
  );
  return homeCand && fs.existsSync(homeCand) ? homeCand : null;
}

function notify1Initialized(workspace: string, fromIp: string | null, seatCount: number): void {
  runInboxDesktopNotifySync(workspace, {
    topic: "OC Restart Initialized",
    phase: "starting",
    sessionAbout:
      `Carrier ${fromIp ?? "?"}. Rebooting CPE; on new IP kill→revive opencode-cpe + CONTINUE ` +
      `across pia+zsign+seatmesh (${seatCount} seats).`,
    check: "Toast 2 = stuck >30m (Reboot). Same-IP #1 = silent 2nd reboot; #2 = same-IP notify + atomics. New IP = atomics.",
  });
}

function notify2Stuck(ep: OcLimitV2Episode, log: (line: string) => void): void {
  const ageMin = Math.round((Date.now() - ep.startedAt) / 60_000);
  const rebootUrl = `http://127.0.0.1:${ep.inboxPort}/connectivity/oc-reboot`;
  const title = "inbox · OC Restart stuck (30m+)";
  const body =
    `Still no new carrier IP after ${ageMin}m (was ${ep.fromIp ?? "?"}). ` +
    `Press Reboot to run cpe-reboot again.`;

  if (shouldSkipDesktopNotify(ep.workspace)) {
    log("OC-V2 stuck notify skipped (desktop mute)");
    return;
  }

  const ok = spawnLinuxActionButtonsToast({
    title,
    body,
    actions: [{ id: "reboot", label: "Reboot", kind: "curl", url: rebootUrl }],
  });
  log(`OC-V2 stuck toast ok=${ok} rebootUrl=${rebootUrl}`);
}

function notify3Success(
  workspace: string,
  fromIp: string | null,
  toIp: string,
  revived: number,
  continued: number,
): void {
  runInboxDesktopNotifySync(workspace, {
    topic: "OC Restart",
    phase: "complete",
    sessionAbout:
      `New IP ${fmtIp(fromIp)} → ${fmtIp(toIp)}. Killing CPE OpenCode, reviving opencode-cpe, CONTINUE ` +
      `(revived=${revived} continue=${continued}).`,
    check: "Ack automatic when limit screens clear. Stay on opencode-cpe (:18887).",
  });
}

/** 2nd consecutive same-IP after reboot — carrier did not rotate.
 *  Order (operator): inform man-1 first, then support toast. */
function notifySameIpSecondTime(
  workspace: string,
  fromIp: string | null,
  stillIp: string | null,
  hit: number,
): void {
  const oldEqOld = `${fmtIp(fromIp)} = ${fmtIp(stillIp)} (old = old)`;
  // 1) Man-1 first
  runInboxDesktopNotifySync(workspace, {
    topic: "OC Restart — man-1",
    phase: "incomplete",
    sessionAbout:
      `Same IP again after CPE reboot #${hit}: ${oldEqOld}. ` +
      `Carrier did not rotate. Support toast next; atomics (kill→revive→CONTINUE) follow.`,
    check: "Man-1: note same carrier IP — stay on opencode-cpe (:18887).",
  });
  // 2) Support
  runInboxDesktopNotifySync(workspace, {
    topic: "OC Restart — same IP again (support)",
    phase: "incomplete",
    sessionAbout:
      `Still ${fmtIp(stillIp)} after CPE reboot #${hit} (was ${fmtIp(fromIp)} — old = old). ` +
      `Man-1 already informed. Proceeding with kill→revive opencode-cpe + CONTINUE anyway.`,
    check: "Support: carrier did not rotate. Atomics running; stay on opencode-cpe (:18887).",
  });
}

function runCpeRebootAsync(
  workspace: string,
  log: (line: string) => void,
  onDone: (code: number) => void,
): boolean {
  // Dry-run for same-IP / atomics proves without touching the CPE.
  if (ocV2Dry()) {
    log("OC-V2 dry — skipping real CPE reboot");
    if (active) active.rebootRunning = false;
    setTimeout(() => onDone(0), 50);
    return true;
  }
  const script = resolveCpeRebootScript(workspace);
  if (!script) {
    log("OC-V2 cpe-reboot.sh missing");
    onDone(1);
    return false;
  }
  if (active) active.rebootRunning = true;
  log(`OC-V2 -> ${path.basename(script)}`);
  const child = spawn("bash", [script], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CPE_SKIP_DESKTOP_NOTIFY: "1" },
  });
  const pump = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t) log(`OC-V2 reboot: ${t}`);
    }
  };
  child.stdout?.on("data", pump);
  child.stderr?.on("data", pump);
  child.on("error", (e) => {
    log(`OC-V2 reboot spawn error ${(e as Error).message}`);
    if (active) active.rebootRunning = false;
    onDone(1);
  });
  child.on("close", (code) => {
    if (active) active.rebootRunning = false;
    onDone(code ?? 1);
  });
  return true;
}

function finishWithAtomics(
  ctx: OcLimitV2StartInput,
  toIp: string,
  log: (line: string) => void,
  opts?: { skipSuccessNotify?: boolean },
): void {
  const ep = active;
  if (!ep || ep.finished) return;
  ep.finished = true;
  if (ep.pollTimer) {
    clearInterval(ep.pollTimer);
    ep.pollTimer = null;
  }
  clearInflight();

  // pia + zsign + seatmesh — shared CPE, all must revive opencode-cpe + CONTINUE
  const seats = recordAllMeshesOcProxySeats(ctx.loaded, log);
  ep.seats = seats;

  const byMesh = new Map<string, number>();
  for (const s of seats) byMesh.set(s.mesh, (byMesh.get(s.mesh) ?? 0) + 1);
  const meshSummary = [...byMesh.entries()].map(([m, n]) => `${m}:${n}`).join(" ");
  log(
    `OC-V2 success IP ${ep.fromIp ?? "?"} -> ${toIp}; atomics all-meshes n=${seats.length} [${meshSummary}]`,
  );

  if (!opts?.skipSuccessNotify) {
    notify3Success(ctx.workspace, ep.fromIp, toIp, seats.length, seats.length);
  }

  // Persist seats so a child process (or crash-recovery) can pick them up.
  const atomicsPendingPath = "/tmp/seatmesh-oc-atomics-pending.json";
  fs.writeFileSync(
    atomicsPendingPath,
    JSON.stringify({ fromIp: ep.fromIp, toIp, seats, proxyPort: ep.proxyPort, startedAt: new Date().toISOString() }),
    "utf8",
  );

  if (ocV2Dry()) {
    log(
      `OC-V2 dry — skip kill/revive/CONTINUE (notify already sent); stamp=${atomicsPendingPath}`,
    );
    ctx.state.recoveryRunning = false;
    return;
  }

  const killed = killOcProxySeats(seats, ep.proxyPort, log);
  log(`OC-V2 killed≈${killed}`);

  // Run revive+continue in a detached child so the inbox event loop is never blocked.
  // Child survives inbox HMR/restart; proof lands in /tmp/seatmesh-oc-atomics-child.log.
  const atomicsRunner = resolveAtomicsRunner(ctx.workspace);
  if (atomicsRunner) {
    const childLogPath = "/tmp/seatmesh-oc-atomics-child.log";
    const childLog = fs.openSync(childLogPath, "a");
    const runnerRoot = path.dirname(path.dirname(atomicsRunner)); // …/seatmesh
    const child = spawn(
      "node",
      [atomicsRunner, "--revive-from-stamp", atomicsPendingPath],
      {
        cwd: runnerRoot,
        detached: true,
        stdio: ["ignore", childLog, childLog],
        env: { ...process.env },
      },
    );
    child.unref();
    child.on("exit", (code) => {
      log(`OC-V2 atomics child exit=${code ?? "?"} meshes=[${meshSummary}] log=${childLogPath}`);
      ctx.state.recoveryRunning = false;
      // Keep pending stamp on failure so operator can re-run without re-record.
      if (code === 0) {
        try {
          fs.unlinkSync(atomicsPendingPath);
        } catch {
          /* */
        }
      }
    });
    log(
      `OC-V2 atomics handed off to child pid=${child.pid} seats=${seats.length} [${meshSummary}] log=${childLogPath}`,
    );
  } else {
    // Fallback: inline (blocks event loop — only if runner script not found).
    log("OC-V2 atomics runner not found — falling back to inline (blocks event loop)");
    setTimeout(() => {
      const { revived, paneIds, failed } = reviveOpenCodeCpeSeats(ctx.loaded, seats, log);
      if (failed.length) log(`OC-V2 revive failed: ${failed.join(", ")}`);
      if (paneIds.length === 0) { ctx.state.recoveryRunning = false; return; }
      setTimeout(() => {
        const reg = ctx.registry ?? createRegistryForProfile(ctx.loaded.profile);
        const { continued, missed } = continueOcProxySeats(reg, paneIds, log);
        if (missed.length) log(`OC-V2 CONTINUE missed: ${missed.join(", ")}`);
        ctx.state.recoveryRunning = false;
        log(`OC-V2 atomics done meshes=[${meshSummary}] revived=${revived}/${seats.length} CONTINUE=${continued}/${paneIds.length}`);
      }, CONTINUE_WAIT_MS);
    }, 2000);
  }
}

function tickWaitIp(log: (line: string) => void): void {
  const ep = active;
  const ctx = lastCtx;
  if (!ep || !ctx || ep.finished) return;
  writeInflight({ mesh: path.basename(ep.workspace), phase: "wait-ip" });

  const now = Date.now();
  const ip = syncCarrierIpProbe(ep.workspace, ep.proxyPort);
  if (ip && ep.fromIp && !sameCarrierIp(ep.fromIp, ip)) {
    log(`OC-V2 new IP detected ${fmtIp(ep.fromIp)} -> ${fmtIp(ip)}`);
    finishWithAtomics(ctx, ip, log);
    return;
  }
  // First successful read after reboot when fromIp was unknown —
  // the post-reboot IP IS the new carrier. Proceed with atomics immediately.
  if (ip && (ep.fromIp == null || String(ep.fromIp).trim() === "")) {
    log(`OC-V2 first IP after null-start: ${fmtIp(ip)} — running atomics`);
    finishWithAtomics(ctx, ip, log);
    return;
  }
  // CPE reconnected but kept the same IP (common on some carriers).
  // 1st same-IP hit → silent second CPE reboot.
  // 2nd same-IP hit → notify (old=old) then atomics.
  if (
    ip &&
    sameCarrierIp(ep.fromIp, ip) &&
    ep.rebootCompletedAt !== null &&
    now - ep.rebootCompletedAt >= POST_REBOOT_SAME_IP_MS
  ) {
    ep.sameIpAfterRebootCount += 1;
    const hit = ep.sameIpAfterRebootCount;
    if (hit === 1) {
      log(
        `OC-V2 same IP after reboot #1 (${fmtIp(ep.fromIp)} = ${fmtIp(ip)}) — second CPE reboot (no notify yet)`,
      );
      ep.rebootCompletedAt = null;
      ep.lastStuckAt = now;
      if (!ep.rebootRunning) {
        runCpeRebootAsync(ep.workspace, log, (code) => {
          log(`OC-V2 same-IP second reboot exit=${code}`);
          if (active && !active.finished) active.rebootCompletedAt = Date.now();
        });
      }
      return;
    }
    log(
      `OC-V2 same IP after reboot #${hit} (${fmtIp(ep.fromIp)} = ${fmtIp(ip)}) — notify + atomics`,
    );
    notifySameIpSecondTime(ctx.workspace, ep.fromIp, ip, hit);
    finishWithAtomics(ctx, ip, log, { skipSuccessNotify: true });
    return;
  }

  if (now - ep.startedAt >= OC_RESTART_STUCK_MS && now - ep.lastStuckAt >= OC_RESTART_STUCK_MS) {
    ep.lastStuckAt = now;
    notify2Stuck(ep, log);
  }
}

export interface OcLimitV2StartInput {
  loaded: LoadedProfile;
  registry: ProviderRegistry | null;
  workspace: string;
  session: string;
  baseWindow: string;
  workersWindow: string;
  minisWindow: string;
  proxyPort: number;
  fromIp: string | null;
  state: { recoveryRunning: boolean; rateLimitRecoveryStarted: boolean; lastRotateAt: number };
  log: (line: string) => void;
  /** Skip CPE reboot (tests / dry-run notify path). */
  skipReboot?: boolean;
}

/**
 * Start OC Restart V2 episode (once-gated by caller stamp).
 * Notify 1 → reboot CPE → poll IP → (30m stuck toast) → notify 3 + atomics.
 */
export function startOcLimitV2Episode(input: OcLimitV2StartInput): boolean {
  if (active && !active.finished) {
    input.log("OC-V2 episode already running — skip");
    return false;
  }

  const inboxPort = resolveDaemonPort(input.loaded.profile, input.loaded.workspace);
  const seats = recordAllMeshesOcProxySeats(input.loaded, input.log);

  markRecoveryStamp();
  writeInflight({
    mesh: path.basename(input.workspace),
    startedAt: Date.now(),
    phase: input.skipReboot ? "wait-ip" : "reboot",
  });
  input.state.recoveryRunning = true;
  input.state.rateLimitRecoveryStarted = true;
  input.state.lastRotateAt = Date.now();

  active = {
    workspace: input.workspace,
    proxyPort: input.proxyPort,
    inboxPort,
    fromIp: input.fromIp,
    startedAt: Date.now(),
    lastStuckAt: 0,
    seats,
    rebootCompletedAt: null,
    sameIpAfterRebootCount: 0,
    rebootRunning: false,
    pollTimer: null,
    finished: false,
  };
  lastCtx = input;

  // Notify 1
  notify1Initialized(input.workspace, input.fromIp, seats.length);
  const meshes = [...new Set(seats.map((s) => s.mesh))].join(",");
  input.log(
    `OC-V2 started seats=${seats.length} meshes=${meshes || "-"} fromIp=${input.fromIp ?? "?"} inbox=:${inboxPort}`,
  );

  const beginPoll = () => {
    if (!active || active.finished) return;
    tickWaitIp(input.log);
    active.pollTimer = setInterval(() => tickWaitIp(input.log), IP_POLL_MS);
  };

  if (input.skipReboot) {
    // CPE already rebooted — run atomics immediately with current carrier IP.
    const nowIp = syncCarrierIpProbe(input.workspace, input.proxyPort) || input.fromIp || "0.0.0.0";
    input.log(`OC-V2 skipReboot → immediate atomics ip=${nowIp}`);
    finishWithAtomics(lastCtx!, nowIp, input.log);
    return true;
  }

  runCpeRebootAsync(input.workspace, input.log, (code) => {
    input.log(`OC-V2 initial reboot exit=${code}`);
    if (active) active.rebootCompletedAt = Date.now();
    beginPoll();
  });
  return true;
}

/** Operator pressed Reboot on stuck toast — re-run cpe-reboot, reset stuck clock. */
export function requestOcLimitV2Reboot(log: (line: string) => void): { ok: boolean; reason?: string } {
  const ep = active;
  if (!ep || ep.finished) return { ok: false, reason: "no-active-episode" };
  if (ep.rebootRunning) return { ok: false, reason: "reboot-already-running" };
  ep.lastStuckAt = Date.now(); // give another 30m before next stuck toast
  ep.rebootCompletedAt = null;
  const started = runCpeRebootAsync(ep.workspace, log, (code) => {
    log(`OC-V2 button reboot exit=${code}`);
    if (active && !active.finished) active.rebootCompletedAt = Date.now();
  });
  return started ? { ok: true } : { ok: false, reason: "spawn-failed" };
}

/** Test/ops: force success path with current ipify as "new" IP. */
export function forceOcLimitV2SuccessForTest(log: (line: string) => void): boolean {
  const ctx = lastCtx;
  const ep = active;
  if (!ctx || !ep || ep.finished) return false;
  const ip = syncCarrierIpProbe(ep.workspace, ep.proxyPort) || ep.fromIp || "0.0.0.0";
  // Pretend change
  const toIp = ep.fromIp && ip === ep.fromIp ? `${ip}-revived` : ip;
  finishWithAtomics(ctx, toIp === `${ep.fromIp}-revived` ? ip : toIp, log);
  return true;
}

const ATOMICS_PENDING_PATH = "/tmp/seatmesh-oc-atomics-pending.json";
const ATOMICS_LOCK_PATH = "/tmp/seatmesh-oc-atomics.lock";

function atomicsChildBusy(): boolean {
  try {
    const raw = fs.readFileSync(ATOMICS_LOCK_PATH, "utf8").trim();
    const pid = Number(raw.split(/\s+/)[0]);
    if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) return true;
  } catch {
    /* */
  }
  return false;
}

function handOffAtomicsFromPending(
  workspace: string,
  log: (line: string) => void,
): boolean {
  if (!fs.existsSync(ATOMICS_PENDING_PATH)) return false;
  if (atomicsChildBusy()) {
    log("OC-V2 resume: atomics already running — leave pending");
    return false;
  }
  // Stale pending (exit≠0 left the stamp) — do not re-hand forever on every inbox restart.
  try {
    const st = fs.statSync(ATOMICS_PENDING_PATH);
    const ageMs = Date.now() - st.mtimeMs;
    const maxAgeMs = Number(process.env.OC_ATOMICS_PENDING_MAX_AGE_MS || 15 * 60 * 1000);
    if (ageMs > maxAgeMs) {
      log(`OC-V2 resume: pending atomics stale ageMs=${ageMs} — unlink (no re-hand)`);
      try {
        fs.unlinkSync(ATOMICS_PENDING_PATH);
      } catch {
        /* */
      }
      return false;
    }
  } catch {
    /* */
  }
  const atomicsRunner = resolveAtomicsRunner(workspace);
  if (!atomicsRunner) {
    log("OC-V2 resume: atomics runner missing");
    return false;
  }
  const childLogPath = "/tmp/seatmesh-oc-atomics-child.log";
  const childLog = fs.openSync(childLogPath, "a");
  fs.writeSync(childLog, `\n=== resume atomics ${new Date().toISOString()} ===\n`);
  const runnerRoot = path.dirname(path.dirname(atomicsRunner));
  const child = spawn(
    "node",
    [atomicsRunner, "--revive-from-stamp", ATOMICS_PENDING_PATH],
    {
      cwd: runnerRoot,
      detached: true,
      stdio: ["ignore", childLog, childLog],
      env: { ...process.env },
    },
  );
  child.unref();
  log(`OC-V2 resume: re-handed atomics to child pid=${child.pid} log=${childLogPath}`);
  return true;
}

/**
 * After SIGKILL/HMR: reclaim orphan stamp, resume pending atomics, or
 * skipReboot→atomics when we died in wait-ip (reboot already done).
 */
export function resumeOcLimitV2AfterDaemonRestart(input: OcLimitV2StartInput): void {
  const { log, workspace } = input;
  if (ocLimitV2EpisodeActive()) return;

  // Prefer finishing atomics if kill already wrote the pending stamp.
  if (handOffAtomicsFromPending(workspace, log)) {
    input.state.recoveryRunning = true;
    input.state.rateLimitRecoveryStarted = true;
    return;
  }

  const inflight = readInflight();
  const orphaned = inflight && !pidAlive(inflight.pid);
  if (orphaned && inflight.phase === "wait-ip") {
    log(
      `OC-V2 resume: orphan wait-ip (old pid=${inflight.pid}) — skipReboot→atomics`,
    );
    clearInflight();
    // Keep stamp; episode continues without a second CPE reboot.
    startOcLimitV2Episode({ ...input, skipReboot: true });
    return;
  }

  if (reclaimOrphanOcLimitRecoveryStamp(log)) {
    log("OC-V2 resume: orphan stamp reclaimed — next rising-edge can re-arm");
  }
}

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  meshRuntimePaths,
  providerMonitoredForLimits,
  resolveConnectivityHooks,
  resolveUxConfig,
  uxLimitKinds,
  type LoadedProfile,
  type ProviderRegistry,
  type ResolvedUxConfig,
} from "seat-mesh-core";
import { capturePaneSnapshot, listMeshMonitorPanes } from "seat-mesh-tmux";
import { notifyConnectivityStatus, type ResumeWaveMeta } from "./oc-resume.js";

const PROXY_UP_COOLDOWN_MS = 60_000;
const ROTATE_COOLDOWN_MS = 180_000;
const IPIFY_POLL_MS = 30_000;
/** During PROXY-DOWN episode, still cap sync ipify curls so /health stays responsive. */
const IPIFY_EPISODE_MIN_MS = 15_000;
const PANE_SCAN_BATCH = 4;
/** Grace before clearing a rate-limit episode after the last limited pane clears (flicker). */
const RATE_LIMIT_EPISODE_CLEAR_MS = 120_000;
/** How long a PROXY-DOWN episode may run before operator gets a "still down" toast. */
const PROXY_DOWN_STUCK_NOTIFY_MS = 120_000;
/** Mirrors scripts/cpe-proxy-smart-restart.sh cooldown file (harness parity — do not fork). */
const DEFAULT_SMART_RESTART_STAMP = "/tmp/cpe-proxy-smart-restart.last";
const DEFAULT_SMART_RESTART_COOLDOWN_SEC = 1800;
/** scripts/cpe-proxy-smart-restart.sh exit code for "cooldown still active, skipped". */
const SMART_RESTART_COOLDOWN_EXIT_CODE = 2;

/**
 * Seconds left on the Proxy-SMART file cooldown (0 = none / expired).
 * Reads the same stamp file cpe-proxy-smart-restart.sh writes — never the daemon's
 * own state — so the daemon and any harness script agree on cooldown status.
 */
export function smartRestartCooldownLeftSec(
  stampPath: string = process.env.CPE_SMART_RESTART_STAMP || DEFAULT_SMART_RESTART_STAMP,
  cooldownSec: number = Number(
    process.env.CPE_SMART_RESTART_COOLDOWN_SEC || DEFAULT_SMART_RESTART_COOLDOWN_SEC,
  ),
  nowMs: number = Date.now(),
): number {
  try {
    const last = Number(fs.readFileSync(stampPath, "utf8").trim()) || 0;
    if (!last) return 0;
    const ageSec = Math.floor(nowMs / 1000) - last;
    return ageSec >= cooldownSec ? 0 : cooldownSec - ageSec;
  } catch {
    return 0;
  }
}

/**
 * Consecutive ipify probe failures before treating carrier as down (debounce flaky curls).
 * Exported for unit testing without tmux/process spawning.
 */
export function updateIpifyProbeStreak(
  state: Pick<ConnectivityRecoveryState, "ipifyFailStreak">,
  carrierOk: boolean,
  threshold: number,
): { confirmedDown: boolean; streak: number } {
  const need = Math.max(1, threshold);
  if (carrierOk) {
    state.ipifyFailStreak = 0;
    return { confirmedDown: false, streak: 0 };
  }
  state.ipifyFailStreak += 1;
  return {
    confirmedDown: state.ipifyFailStreak >= need,
    streak: state.ipifyFailStreak,
  };
}

/**
 * Pure rising-edge/episode reducer for the OC-LIMIT (rate-limit) state machine.
 * Exported for unit testing without tmux/process spawning.
 */
export function updateRateLimitEpisode(
  state: Pick<ConnectivityRecoveryState, "rateLimitEpisodeActive" | "lastRateLimitSeenAt">,
  anyRateLimitNow: boolean,
  nowMs: number = Date.now(),
  graceMs: number = RATE_LIMIT_EPISODE_CLEAR_MS,
): { action: "start" | "continue" | "clear" | "none" } {
  if (anyRateLimitNow) {
    state.lastRateLimitSeenAt = nowMs;
    if (!state.rateLimitEpisodeActive) {
      state.rateLimitEpisodeActive = true;
      return { action: "start" };
    }
    return { action: "continue" };
  }
  if (state.rateLimitEpisodeActive && nowMs - state.lastRateLimitSeenAt > graceMs) {
    state.rateLimitEpisodeActive = false;
    return { action: "clear" };
  }
  return { action: "none" };
}

/**
 * Pure decision: after Proxy-SMART exits, should rotate-until run next?
 * Mirrors inbox-server.mjs shouldRunRotateUntilAfterSmart — chain rotate-until
 * when SMART was skipped (cooldown), failed, or the carrier IP did not change.
 */
export function shouldChainRotateUntilAfterSmart(input: {
  exitCode: number;
  ipBefore: string | null;
  ipAfter: string | null;
}): boolean {
  const { exitCode, ipBefore, ipAfter } = input;
  if (exitCode === SMART_RESTART_COOLDOWN_EXIT_CODE) return true;
  if (!ipAfter) return true;
  if (ipBefore && ipAfter && ipBefore === ipAfter) return true;
  return exitCode !== 0;
}

function wifiProbeLockActive(loaded: LoadedProfile): boolean {
  const lock = meshRuntimePaths(loaded).wifiProbeLock;
  try {
    return fs.existsSync(lock);
  } catch {
    return false;
  }
}

let cachedIpifyUp: boolean | null = null;
let lastIpifyAt = 0;
let paneScanOffset = 0;
/** Last carrier IP actually observed while up — a live fetch during an outage always fails. */
let lastKnownGoodIp: string | null = null;
const paneLimitCache = new Map<string, { connect: boolean; rate: boolean }>();

function anyRateLimitInCache(): boolean {
  for (const flags of paneLimitCache.values()) {
    if (flags.rate) return true;
  }
  return false;
}

/** Drop OC-LIMIT border state for a pane once resume ack confirms it is working again. */
export function clearOcLimitBannerForPane(
  state: ConnectivityRecoveryState,
  paneId: string,
): boolean {
  const had =
    paneLimitCache.has(paneId) ||
    state.ocLimited.has(paneId) ||
    state.connectPanes.has(paneId);
  paneLimitCache.delete(paneId);
  state.ocLimited.delete(paneId);
  state.connectPanes.delete(paneId);
  return had;
}

/** When no panes remain limited, end the OC-LIMIT episode so borders and proxy recovery unlock. */
export function maybeEndRateLimitEpisode(state: ConnectivityRecoveryState): void {
  if (anyRateLimitInCache()) return;
  if (!state.rateLimitEpisodeActive && !state.rateLimitRecoveryStarted) return;
  state.rateLimitEpisodeActive = false;
  state.rateLimitRecoveryStarted = false;
  state.lastRateLimitSeenAt = 0;
}

export interface ConnectivityRecoveryState {
  ocLimited: Set<string>;
  connectPanes: Set<string>;
  proxyDownActive: boolean;
  recoveryRunning: boolean;
  lastProxyUpAt: number;
  lastRotateAt: number;
  /** Carrier IP when PROXY-DOWN episode started (for notify on recovery). */
  carrierIpAtEpisodeStart: string | null;
  /** True while ANY OC pane has shown a rate-limit this episode (rising-edge gate). */
  rateLimitEpisodeActive: boolean;
  /** ms epoch a rate-limited pane was last observed (episode-clear grace timer). */
  lastRateLimitSeenAt: number;
  /** ms epoch the current PROXY-DOWN episode started (0 = no active episode). */
  proxyDownEpisodeStartAt: number;
  /** True once the "still down" toast has fired for the current episode (no repeat spam). */
  proxyDownStuckNotified: boolean;
  /** One Proxy-SMART/rotate-until per OC-LIMIT episode — no restart loop while banner persists. */
  rateLimitRecoveryStarted: boolean;
  /** Consecutive daemon polls where ipify via proxy failed (reset on success). */
  ipifyFailStreak: number;
}

export function newConnectivityRecoveryState(): ConnectivityRecoveryState {
  return {
    ocLimited: new Set(),
    connectPanes: new Set(),
    proxyDownActive: false,
    recoveryRunning: false,
    lastProxyUpAt: 0,
    lastRotateAt: 0,
    carrierIpAtEpisodeStart: null,
    rateLimitEpisodeActive: false,
    lastRateLimitSeenAt: 0,
    proxyDownEpisodeStartAt: 0,
    proxyDownStuckNotified: false,
    rateLimitRecoveryStarted: false,
    ipifyFailStreak: 0,
  };
}

/**
 * Pure decision: has a PROXY-DOWN episode been running long enough, with no
 * "still down" toast sent yet, to warrant telling operator it's stuck (not silent)?
 * Exported for unit testing without tmux/process spawning.
 */
export function shouldNotifyProxyDownStuck(
  state: Pick<ConnectivityRecoveryState, "proxyDownEpisodeStartAt" | "proxyDownStuckNotified">,
  nowMs: number = Date.now(),
  thresholdMs: number = PROXY_DOWN_STUCK_NOTIFY_MS,
): boolean {
  if (state.proxyDownStuckNotified) return false;
  if (!state.proxyDownEpisodeStartAt) return false;
  return nowMs - state.proxyDownEpisodeStartAt >= thresholdMs;
}

let ipifyProbeInFlight = false;

/** Non-blocking ipify refresh — poll tick and /health must never wait on curl. */
function scheduleIpifyProbe(workspace: string, port: number): void {
  if (ipifyProbeInFlight) return;
  ipifyProbeInFlight = true;
  const child = spawn(
    "bash",
    [
      "-c",
      `HTTPS_PROXY=http://127.0.0.1:${port} HTTP_PROXY=http://127.0.0.1:${port} curl -4 -sS -m 3 https://api.ipify.org 2>/dev/null || true`,
    ],
    { cwd: workspace, stdio: ["ignore", "pipe", "ignore"] },
  );
  let out = "";
  child.stdout?.on("data", (c) => {
    out += String(c);
  });
  child.on("close", () => {
    ipifyProbeInFlight = false;
    lastIpifyAt = Date.now();
    const ip = out.trim();
    cachedIpifyUp = Boolean(ip);
    if (ip) lastKnownGoodIp = ip;
  });
  child.on("error", () => {
    ipifyProbeInFlight = false;
    lastIpifyAt = Date.now();
    cachedIpifyUp = false;
  });
}

function carrierIpCached(): string | null {
  return lastKnownGoodIp;
}

function ipifyUp(workspace: string, port: number, episode = false): boolean {
  const now = Date.now();
  const minGap = episode ? IPIFY_EPISODE_MIN_MS : IPIFY_POLL_MS;
  if (now - lastIpifyAt >= minGap) {
    scheduleIpifyProbe(workspace, port);
  }
  if (cachedIpifyUp !== null) return cachedIpifyUp;
  return true;
}

function runScriptAsync(
  workspace: string,
  scriptPath: string,
  log: (line: string) => void,
  label: string,
  onDone: (code: number) => void,
): boolean {
  if (!fs.existsSync(scriptPath)) {
    log(`${label}: missing ${scriptPath}`);
    return false;
  }
  const child = spawn("bash", [scriptPath], {
    cwd: workspace,
    stdio: "ignore",
    detached: false,
    env: { ...process.env, CPE_SKIP_DESKTOP_NOTIFY: "1" },
  });
  child.on("error", (e) => {
    log(`${label}: spawn error ${(e as Error).message}`);
    onDone(1);
  });
  child.on("close", (code) => onDone(code ?? 1));
  return true;
}

export interface ConnectivityPollInput {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  workspace: string;
  session: string;
  baseWindow: string;
  workersWindow: string;
  minisWindow: string;
  state: ConnectivityRecoveryState;
  log: (line: string) => void;
  resumeOpenCodePanes: (reason: string, meta?: ResumeWaveMeta) => void;
}

/** Scan all monitor panes; update limit sets; trigger async recovery on rising edges only. */
export function pollConnectivityRecovery(input: ConnectivityPollInput): void {
  const {
    loaded,
    registry,
    workspace,
    session,
    baseWindow,
    workersWindow,
    minisWindow,
    state,
    log,
    resumeOpenCodePanes,
  } = input;

  const conn = loaded.profile.connectivity;
  if (!conn?.enabled) return;

  const proxyPort = conn.proxyPort ?? 18887;
  const panes = listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow);
  const liveIds = new Set(panes.map((p) => p.paneId));
  for (const id of paneLimitCache.keys()) {
    if (!liveIds.has(id)) paneLimitCache.delete(id);
  }

  const prevConnect = new Set(state.connectPanes);
  const prevLimited = new Set(state.ocLimited);

  const batch: typeof panes = [];
  if (panes.length) {
    for (let i = 0; i < Math.min(PANE_SCAN_BATCH, panes.length); i++) {
      batch.push(panes[(paneScanOffset + i) % panes.length]!);
    }
    paneScanOffset = (paneScanOffset + batch.length) % panes.length;
  }

  const uxResolved: ResolvedUxConfig | null =
    loaded.profile.ux !== undefined ? resolveUxConfig(loaded.profile.ux) : null;
  const { proxyDownKinds, rateLimitKinds, limitProviders } = uxResolved
    ? uxLimitKinds(uxResolved)
    : {
        proxyDownKinds: new Set(["oc-connect"]),
        rateLimitKinds: new Set(["oc-limit"]),
        limitProviders: new Set(["opencode"]),
      };

  for (const { paneId, label } of batch) {
    const snap = capturePaneSnapshot(paneId);
    if (!snap) {
      paneLimitCache.delete(paneId);
      continue;
    }
    const prov = registry.detect(snap);
    if (!prov || !providerMonitoredForLimits(prov.id, limitProviders)) {
      paneLimitCache.delete(paneId);
      continue;
    }
    const st = prov.composerState(snap);
    if (st.phase !== "limit" || !st.limitKind) {
      paneLimitCache.delete(paneId);
      continue;
    }
    const connect = proxyDownKinds.has(st.limitKind);
    const rate = rateLimitKinds.has(st.limitKind);
    if (!connect && !rate) {
      paneLimitCache.delete(paneId);
      continue;
    }
    paneLimitCache.set(paneId, { connect, rate });
    if (connect && !prevConnect.has(paneId)) {
      log(`PROXY-DOWN rising ${label} ${paneId} kind=${st.limitKind}`);
    } else if (rate && !prevLimited.has(paneId)) {
      log(`OC-LIMIT rising ${label} ${paneId} kind=${st.limitKind}`);
    }
  }

  state.connectPanes.clear();
  state.ocLimited.clear();
  let anyConnect = false;
  let anyRateLimit = false;
  for (const [paneId, flags] of paneLimitCache) {
    if (!liveIds.has(paneId)) continue;
    state.ocLimited.add(paneId);
    if (flags.connect) {
      state.connectPanes.add(paneId);
      anyConnect = true;
    } else if (flags.rate) {
      anyRateLimit = true;
    }
  }

  const hooks = resolveConnectivityHooks(loaded.profile, workspace);

  if (wifiProbeLockActive(loaded)) {
    if (state.proxyDownActive) {
      log("PROXY-DOWN suppressed — cpe-wifi-probe.lock active");
      state.proxyDownActive = false;
    }
    return;
  }

  const carrierOk = ipifyUp(workspace, proxyPort, anyConnect || state.proxyDownActive);
  const ipifyThreshold = conn.policy?.ipifyFailBeforeRecovery ?? 3;
  const { confirmedDown: ipifyConfirmedDown, streak: ipifyStreak } = updateIpifyProbeStreak(
    state,
    carrierOk,
    ipifyThreshold,
  );
  if (!carrierOk && !ipifyConfirmedDown && !anyConnect) {
    log(
      `ipify probe fail streak ${ipifyStreak}/${ipifyThreshold} — defer PROXY-DOWN recovery`,
    );
  }
  const proxyDownNow = anyConnect || ipifyConfirmedDown;
  const wasDown = state.proxyDownActive;
  state.proxyDownActive = proxyDownNow;

  if (proxyDownNow && !wasDown) {
    state.carrierIpAtEpisodeStart = carrierIpCached();
    state.proxyDownEpisodeStartAt = Date.now();
    state.proxyDownStuckNotified = false;
    log(
      `PROXY-DOWN episode start ipify=${carrierOk ? "up" : "down"} streak=${ipifyStreak}/${ipifyThreshold} connectPanes=${state.connectPanes.size} carrier=${state.carrierIpAtEpisodeStart ?? "?"}`,
    );
    notifyConnectivityStatus(
      workspace,
      "PROXY-DOWN",
      `Carrier ${state.carrierIpAtEpisodeStart ?? "?"} unreachable. Running cpe-proxy-up.sh now.`,
      "Wait for resume-sent then complete toasts — no action during starting.",
      "starting",
    );
    maybeRunProxyUp(hooks, workspace, state, log);
  } else if (!proxyDownNow && wasDown) {
    const fromIp = state.carrierIpAtEpisodeStart;
    const toIp = carrierIpCached();
    log(`PROXY-DOWN episode clear -> resume wave carrier=${toIp ?? "?"}`);
    state.carrierIpAtEpisodeStart = null;
    state.proxyDownEpisodeStartAt = 0;
    state.proxyDownStuckNotified = false;
    state.ipifyFailStreak = 0;
    // Keep rate-limit cache entries — clearing all panes made OC-LIMIT episodes re-arm proxy restart.
    for (const [paneId, flags] of [...paneLimitCache.entries()]) {
      if (flags.rate) {
        paneLimitCache.set(paneId, { connect: false, rate: true });
      } else {
        paneLimitCache.delete(paneId);
      }
    }
    setImmediate(() => resumeOpenCodePanes("proxy-up", { fromIp, toIp }));
  } else if (proxyDownNow && wasDown && shouldNotifyProxyDownStuck(state)) {
    state.proxyDownStuckNotified = true;
    const ageSec = Math.round((Date.now() - state.proxyDownEpisodeStartAt) / 1000);
    log(`PROXY-DOWN still active after ${ageSec}s -> notify operator`);
    notifyConnectivityStatus(
      workspace,
      "PROXY-DOWN",
      `Carrier still unreachable after ${ageSec}s. cpe-proxy-up.sh ran; on cooldown.`,
      "Check WiFi/CPE manually if this persists.",
      "incomplete",
    );
  }

  const { action } = updateRateLimitEpisode(state, anyRateLimit);
  if (action === "start") {
    const fromIp = carrierIpCached() ?? state.carrierIpAtEpisodeStart ?? lastKnownGoodIp;
    log(`OC-LIMIT rising-edge episode start carrier=${fromIp ?? "?"}`);
    if (!state.rateLimitRecoveryStarted) {
      notifyConnectivityStatus(
        workspace,
        "OC-LIMIT",
        `Carrier ${fromIp ?? "?"} rate-limited. One proxy recovery run for this episode (no repeat while banner persists).`,
        "Wait for resume-sent then complete toasts. Ack is automatic when limit screens clear.",
        "starting",
      );
      maybeRunOcLimitRecovery(hooks, workspace, proxyPort, fromIp, state, log, resumeOpenCodePanes);
    } else {
      log("OC-LIMIT episode active — recovery already ran this episode (skip proxy restart)");
    }
  } else if (action === "clear") {
    log("OC-LIMIT episode clear");
    state.rateLimitRecoveryStarted = false;
  }
}

function maybeRunProxyUp(
  hooks: ReturnType<typeof resolveConnectivityHooks>,
  workspace: string,
  state: ConnectivityRecoveryState,
  log: (line: string) => void,
): void {
  const now = Date.now();
  if (state.recoveryRunning) return;
  if (now - state.lastProxyUpAt < PROXY_UP_COOLDOWN_MS) return;
  const script = hooks?.up;
  if (!script) {
    log("PROXY-DOWN: connectivity.hooks.up not configured — skip");
    return;
  }

  state.recoveryRunning = true;
  state.lastProxyUpAt = now;
  log(`PROXY-DOWN -> async ${path.basename(script)}`);
  const started = runScriptAsync(workspace, script, log, "proxy-up", (code) => {
    state.recoveryRunning = false;
    log(`cpe-proxy-up exit=${code} — resume wave waits for PROXY-DOWN episode clear`);
  });
  if (!started) state.recoveryRunning = false;
}

/**
 * OC-LIMIT (rate-limit) recovery: Proxy-SMART restart first when off cooldown,
 * else cpe-proxy-rotate-until.sh directly. Chains rotate-until after a SMART
 * run that was skipped/failed/no-op, then notifies operator + resumes OC panes on
 * any real carrier IP change. Mirrors inbox-server.mjs runOcLimitRecoveryAsync.
 */
function maybeRunOcLimitRecovery(
  hooks: ReturnType<typeof resolveConnectivityHooks>,
  workspace: string,
  proxyPort: number,
  fromIp: string | null,
  state: ConnectivityRecoveryState,
  log: (line: string) => void,
  resumeOpenCodePanes: ConnectivityPollInput["resumeOpenCodePanes"],
): void {
  const now = Date.now();
  if (state.recoveryRunning) return;
  if (state.rateLimitRecoveryStarted) return;
  if (now - state.lastRotateAt < ROTATE_COOLDOWN_MS) return;

  state.recoveryRunning = true;
  state.rateLimitRecoveryStarted = true;
  state.lastRotateAt = now;

  const finish = (toIp: string | null, reason: string) => {
    state.recoveryRunning = false;
    const ipChanged = Boolean(toIp && fromIp && toIp !== fromIp);
    if (!ipChanged) {
      log(
        `OC-LIMIT recovery done reason=${reason} ip=${toIp ?? "?"} — skip resume wave (no carrier change)`,
      );
      return;
    }
    log(`OC-LIMIT recovery done -> resume wave reason=${reason} ${fromIp} -> ${toIp}`);
    setImmediate(() => resumeOpenCodePanes(reason, { fromIp, toIp }));
  };

  const runRotateUntil = (reason: string) => {
    const script = hooks?.rotate;
    if (!script || !fs.existsSync(script)) {
      log(`OC-LIMIT recovery: connectivity.hooks.rotate missing (${script ?? "unset"})`);
      state.recoveryRunning = false;
      return;
    }
    log(`OC-LIMIT -> async ${path.basename(script)} (${reason})`);
    const started = runScriptAsync(workspace, script, log, "rotate-until", (code) => {
      log(`rotate-until exit=${code}`);
      scheduleIpifyProbe(workspace, proxyPort);
      finish(carrierIpCached(), "rotate-until");
    });
    if (!started) state.recoveryRunning = false;
  };

  const cooldownLeft = smartRestartCooldownLeftSec();
  if (cooldownLeft > 0) {
    log(`OC-LIMIT Proxy-SMART cooldown ${cooldownLeft}s -> rotate-until path`);
    runRotateUntil("smart-cooldown");
    return;
  }

  const smartScript = hooks?.smartRestart;
  if (!smartScript || !fs.existsSync(smartScript)) {
    log(`OC-LIMIT rising-edge but hooks.smartRestart missing -> rotate-until`);
    runRotateUntil("no-smart-script");
    return;
  }

  log(`OC-LIMIT rising-edge -> async ${path.basename(smartScript)}`);
  const started = runScriptAsync(workspace, smartScript, log, "cpe-proxy-smart-restart", (code) => {
    log(`cpe-proxy-smart-restart exit=${code}`);
    scheduleIpifyProbe(workspace, proxyPort);
    const ipAfter = carrierIpCached();
    if (shouldChainRotateUntilAfterSmart({ exitCode: code, ipBefore: fromIp, ipAfter })) {
      const chainReason = code === SMART_RESTART_COOLDOWN_EXIT_CODE ? "smart-cooldown" : "smart-unchanged";
      notifyConnectivityStatus(
        workspace,
        "OC-LIMIT",
        `Proxy-SMART did not clear it (${chainReason}). Escalating to cpe-proxy-rotate-until.sh.`,
        "Wait for resume-sent then complete toasts.",
        "escalating",
      );
      runRotateUntil(chainReason);
      return;
    }
    finish(ipAfter, "proxy-smart-restart");
  });
  if (!started) state.recoveryRunning = false;
}

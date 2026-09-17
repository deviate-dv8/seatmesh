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
} from "@seat-mesh/core";
import { capturePaneSnapshot, listMeshMonitorPanes } from "@seat-mesh/tmux";
import { notifyConnectivityStatus, type ResumeWaveMeta } from "./oc-resume.js";
import { syncCarrierIpProbe } from "./oc-resume-broadcast.js";
import {
  ocLimitV2EpisodeActive,
  reclaimOrphanOcLimitRecoveryStamp,
  startOcLimitV2Episode,
} from "./oc-limit-v2.js";

const PROXY_UP_COOLDOWN_MS = 60_000;
/** After an episode clears, ignore stale oc-connect re-arm unless streak re-confirms. */
const PROXY_DOWN_REARM_COOLDOWN_MS = 90_000;
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
 * Cross-mesh OC-LIMIT recovery stamp. Survives HMR/SIGKILL child restarts so
 * pia+zsign+seatmesh do not each re-arm notify-send + oc-reset every respawn.
 * Shared CPE → one stamp for all meshes.
 */
const DEFAULT_OC_LIMIT_RECOVERY_STAMP = "/tmp/seatmesh-oc-limit-recovery.last";
const DEFAULT_OC_LIMIT_RECOVERY_COOLDOWN_SEC = 1800;
/** Once-per-stamp toast when rising-edge is suppressed (avoid silent cooldown). */
const OC_LIMIT_COOLDOWN_NOTIFIED =
  process.env.CPE_OC_LIMIT_COOLDOWN_NOTIFIED || "/tmp/seatmesh-oc-limit-cooldown-notified";

function notifyOcLimitCooldownOnce(workspace: string, stampLeft: number, log: (line: string) => void): void {
  let stampTok = "";
  try {
    stampTok = fs.readFileSync(
      process.env.CPE_OC_LIMIT_RECOVERY_STAMP || DEFAULT_OC_LIMIT_RECOVERY_STAMP,
      "utf8",
    ).trim();
  } catch {
    stampTok = String(stampLeft);
  }
  try {
    const prev = fs.readFileSync(OC_LIMIT_COOLDOWN_NOTIFIED, "utf8").trim();
    if (prev === stampTok) return;
  } catch {
    /* first time */
  }
  try {
    fs.writeFileSync(OC_LIMIT_COOLDOWN_NOTIFIED, `${stampTok}\n`, "utf8");
  } catch {
    /* */
  }
  log(`OC-LIMIT cooldown notify (once) left=${stampLeft}s`);
  notifyConnectivityStatus(
    workspace,
    "OC-LIMIT",
    `Rate-limit seen; recovery cooldown ${stampLeft}s (stamp /tmp/seatmesh-oc-limit-recovery.last).`,
    "If no OC Restart toast ran, clear stamp or POST /connectivity/oc-restart-v2.",
    "incomplete",
  );
}

/**
 * Seconds left on a stamp-file cooldown (0 = none / expired).
 */
export function stampCooldownLeftSec(
  stampPath: string,
  cooldownSec: number,
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
  return stampCooldownLeftSec(stampPath, cooldownSec, nowMs);
}

/** Seconds left before another OC-LIMIT reset+toast is allowed (cross-mesh). */
export function ocLimitRecoveryCooldownLeftSec(
  stampPath: string = process.env.CPE_OC_LIMIT_RECOVERY_STAMP || DEFAULT_OC_LIMIT_RECOVERY_STAMP,
  cooldownSec: number = Number(
    process.env.CPE_OC_LIMIT_RECOVERY_COOLDOWN_SEC || DEFAULT_OC_LIMIT_RECOVERY_COOLDOWN_SEC,
  ),
  nowMs: number = Date.now(),
): number {
  return stampCooldownLeftSec(stampPath, cooldownSec, nowMs);
}

/** Mark OC-LIMIT recovery as started — blocks sibling meshes / HMR respawns. */
export function markOcLimitRecoveryStarted(
  stampPath: string = process.env.CPE_OC_LIMIT_RECOVERY_STAMP || DEFAULT_OC_LIMIT_RECOVERY_STAMP,
  nowMs: number = Date.now(),
): void {
  try {
    fs.writeFileSync(stampPath, `${Math.floor(nowMs / 1000)}\n`, "utf8");
  } catch {
    /* best-effort */
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
 * Pure decision: after Proxy-SMART exits, should wait-ip run next?
 * Mirrors inbox-server.mjs shouldRunRotateUntilAfterSmart — chain wait-ip poll
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
/** Per-pane consecutive oc-connect observations (batch scan), not scrollback one-shots. */
const paneConnectStreak = new Map<string, number>();
const paneCcLimitSeen = new Set<string>();
/** Last atomic-4 CONTINUE attempt while still on oc-credit (miss → retry). */
const ocCreditContinueAt = new Map<string, number>();
const OC_CREDIT_CONTINUE_COOLDOWN_MS = 45_000;
let lastProxyDownClearAt = 0;

/** Exported for unit tests. */
export function updatePaneConnectStreak(
  streakMap: Map<string, number>,
  paneId: string,
  sawConnect: boolean,
  threshold: number,
): { confirmed: boolean; streak: number } {
  const need = Math.max(1, threshold);
  if (!sawConnect) {
    streakMap.delete(paneId);
    return { confirmed: false, streak: 0 };
  }
  const streak = (streakMap.get(paneId) ?? 0) + 1;
  streakMap.set(paneId, streak);
  return { confirmed: streak >= need, streak };
}

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
  paneConnectStreak.delete(paneId);
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
/**
 * PROXY-DOWN episode vs OC-LIMIT (rate-limit) — keep separate.
 * - PROXY-DOWN: confirmed oc-connect transport failure only (debounced pane streak).
 * - OC-LIMIT: instant wait-ip / carrier rotate; never fold ipify blips or rate-limit into PROXY-DOWN.
 */
export function shouldActivateProxyDownEpisode(input: {
  anyConnectConfirmed: boolean;
}): boolean {
  return input.anyConnectConfirmed;
}

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
      `via="$(${curlViaProxy(port)} 2>/dev/null)"; ` +
        `eth="$(env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u ALL_PROXY -u all_proxy ` +
        `curl -4 -sS -m 3 https://api.ipify.org 2>/dev/null)"; ` +
        `printf '%s\n%s\n' "$via" "$eth"`,
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
    const [via, eth] = out.trim().split(/\n/, 2);
    const ip = (via ?? "").trim();
    const direct = (eth ?? "").trim();
    // via == eth means gost egresses through the host eth — not the CPE carrier.
    // Keep the previous known-good IP so rotation detection still sees the change.
    const valid = Boolean(ip && (!direct || ip !== direct));
    cachedIpifyUp = valid;
    if (valid) lastKnownGoodIp = ip;
  });
  child.on("error", () => {
    ipifyProbeInFlight = false;
    lastIpifyAt = Date.now();
    cachedIpifyUp = false;
  });
}

function curlViaProxy(port: number): string {
  return `HTTPS_PROXY=http://127.0.0.1:${port} HTTP_PROXY=http://127.0.0.1:${port} curl -4 -sS -m 3 https://api.ipify.org`;
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
  extraEnv: Record<string, string> = {},
): boolean {
  if (!fs.existsSync(scriptPath)) {
    log(`${label}: missing ${scriptPath}`);
    return false;
  }
  // Capture script stdout/stderr into daemon log (oc-reset was silent with stdio ignore).
  const child = spawn("bash", [scriptPath], {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: { ...process.env, CPE_SKIP_DESKTOP_NOTIFY: "1", ...extraEnv },
  });
  const pump = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t) log(`${label}: ${t}`);
    }
  };
  child.stdout?.on("data", pump);
  child.stderr?.on("data", pump);
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
  /** Claude cc-limit rising edge — schedule session-scoped retry checkback. */
  onCcLimitRise?: (paneId: string, snap: import("@seat-mesh/core").PaneSnapshot) => void;
  onCursorUsageLimitRise?: (paneId: string, snap: import("@seat-mesh/core").PaneSnapshot) => void;
  /**
   * OpenCode router credit gate (insufficient_user_quota) — intermittent.
   * Do not arm CPE OC-LIMIT; caller should run atomic 4 CONTINUE on the pane.
   */
  onOcCreditRise?: (paneId: string, snap: import("@seat-mesh/core").PaneSnapshot) => void;
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
    onCcLimitRise,
    onCursorUsageLimitRise,
    onOcCreditRise,
  } = input;

  const conn = loaded.profile.connectivity;
  if (!conn?.enabled) return;

  const proxyPort = conn.proxyPort ?? 18887;
  const panes = listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow);
  const liveIds = new Set(panes.map((p) => p.paneId));
  for (const id of paneLimitCache.keys()) {
    if (!liveIds.has(id)) paneLimitCache.delete(id);
  }
  for (const id of paneConnectStreak.keys()) {
    if (!liveIds.has(id)) paneConnectStreak.delete(id);
  }
  for (const id of paneCcLimitSeen) {
    // Compound keys: `${paneId}:oc-credit` / `:cursor-usage` / `:kiro-limit`
    const paneId = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    if (!liveIds.has(paneId)) paneCcLimitSeen.delete(id);
  }
  for (const key of ocCreditContinueAt.keys()) {
    const paneId = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
    if (!liveIds.has(paneId)) ocCreditContinueAt.delete(key);
  }

  const connectThreshold =
    conn.policy?.connectFailBeforeRecovery ??
    conn.policy?.ipifyFailBeforeRecovery ??
    15;

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
    if (st.phase === "limit" && st.limitKind === "cc-limit" && prov.id === "claude") {
      if (!paneCcLimitSeen.has(paneId)) {
        paneCcLimitSeen.add(paneId);
        onCcLimitRise?.(paneId, snap);
        log(`CC-LIMIT rising ${label} ${paneId}`);
      }
      continue;
    }
    if (
      st.phase === "limit" &&
      st.limitKind === "cursor-usage-limit" &&
      prov.id === "cursor-agent"
    ) {
      if (!paneCcLimitSeen.has(`${paneId}:cursor-usage`)) {
        paneCcLimitSeen.add(`${paneId}:cursor-usage`);
        onCursorUsageLimitRise?.(paneId, snap);
        log(`CURSOR-LIMIT rising ${label} ${paneId}`);
      }
      continue;
    }
    if (st.phase === "limit" && st.limitKind === "kiro-limit" && prov.id === "kiro") {
      if (!paneCcLimitSeen.has(`${paneId}:kiro-limit`)) {
        paneCcLimitSeen.add(`${paneId}:kiro-limit`);
        // Hold inject (queue) via limit phase — do not run OC proxy recovery.
        log(`KIRO-LIMIT rising ${label} ${paneId} — queue held, continue other seats`);
      }
      continue;
    }
    // OrcaRouter credit gate — intermittent; atomic 4 CONTINUE (not CPE reboot).
    // Retry on cooldown while banner stays — first inject often misses error UI.
    if (st.phase === "limit" && st.limitKind === "oc-credit" && prov.id === "opencode") {
      const key = `${paneId}:oc-credit`;
      const now = Date.now();
      const lastAt = ocCreditContinueAt.get(key) ?? 0;
      const isRising = !paneCcLimitSeen.has(key);
      if (isRising) {
        paneCcLimitSeen.add(key);
        log(
          `OC-CREDIT rising ${label} ${paneId} kind=oc-credit — intermittent router quota; atomic 4 CONTINUE`,
        );
      }
      if (isRising || now - lastAt >= OC_CREDIT_CONTINUE_COOLDOWN_MS) {
        ocCreditContinueAt.set(key, now);
        if (!isRising) {
          log(
            `OC-CREDIT retry ${label} ${paneId} — still credit-gated; atomic 4 CONTINUE again`,
          );
        }
        onOcCreditRise?.(paneId, snap);
      }
      continue;
    }
    if (st.phase !== "limit" || !st.limitKind) {
      paneLimitCache.delete(paneId);
      paneConnectStreak.delete(paneId);
      paneCcLimitSeen.delete(paneId);
      paneCcLimitSeen.delete(`${paneId}:oc-credit`);
      ocCreditContinueAt.delete(`${paneId}:oc-credit`);
      continue;
    }
    const sawConnect = proxyDownKinds.has(st.limitKind);
    const rate = rateLimitKinds.has(st.limitKind);
    if (!sawConnect && !rate) {
      paneLimitCache.delete(paneId);
      paneConnectStreak.delete(paneId);
      continue;
    }
    let connect = false;
    if (sawConnect) {
      const { confirmed, streak } = updatePaneConnectStreak(
        paneConnectStreak,
        paneId,
        true,
        connectThreshold,
      );
      connect = confirmed;
      if (!confirmed) {
        if (streak === 1) {
          log(
            `PROXY-DOWN defer ${label} ${paneId} (need ${connectThreshold} connect observations — stale scrollback filter)`,
          );
        }
      } else if (!prevConnect.has(paneId)) {
        log(`PROXY-DOWN rising ${label} ${paneId} kind=${st.limitKind} streak=${streak}`);
      }
    } else {
      updatePaneConnectStreak(paneConnectStreak, paneId, false, connectThreshold);
    }
    if (connect || rate) {
      paneLimitCache.set(paneId, { connect, rate });
    } else {
      paneLimitCache.delete(paneId);
    }
    if (rate && !prevLimited.has(paneId)) {
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
  const ipifyThreshold = conn.policy?.ipifyFailBeforeRecovery ?? 15;
  const { confirmedDown: ipifyConfirmedDown, streak: ipifyStreak } = updateIpifyProbeStreak(
    state,
    carrierOk,
    ipifyThreshold,
  );
  if (!carrierOk && !ipifyConfirmedDown && !anyConnect) {
    log(
      `ipify probe fail streak ${ipifyStreak}/${ipifyThreshold} — OC-LIMIT owns rotate when rate-limited; PROXY-DOWN needs confirmed connect`,
    );
  }
  let proxyDownNow = shouldActivateProxyDownEpisode({ anyConnectConfirmed: anyConnect });
  const wasDown = state.proxyDownActive;
  const rearmBlocked =
    !wasDown &&
    proxyDownNow &&
    anyConnect &&
    carrierOk &&
    Date.now() - lastProxyDownClearAt < PROXY_DOWN_REARM_COOLDOWN_MS;
  if (rearmBlocked) {
    log(
      `PROXY-DOWN re-arm suppressed (episode cooldown ${PROXY_DOWN_REARM_COOLDOWN_MS / 1000}s, ipify up, connect debounced)`,
    );
    proxyDownNow = false;
  }
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
    lastProxyDownClearAt = Date.now();
    paneConnectStreak.clear();
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
    let stampLeft = ocLimitRecoveryCooldownLeftSec();
    // SIGKILL mid-reboot leaves stamp with no live V2 → reclaim so notify/reset re-arm.
    if (stampLeft > 0 && reclaimOrphanOcLimitRecoveryStamp(log)) {
      stampLeft = 0;
    }
    if (stampLeft > 0) {
      // HMR/SIGKILL wipe in-memory rateLimitRecoveryStarted; stamp is the real once-gate.
      state.rateLimitRecoveryStarted = true;
      log(
        `OC-LIMIT rising-edge suppressed — shared recovery stamp cooldown ${stampLeft}s (live V2 / cooldown)`,
      );
      notifyOcLimitCooldownOnce(workspace, stampLeft, log);
    } else if (!state.rateLimitRecoveryStarted) {
      maybeRunOcLimitRecovery(
        loaded,
        registry,
        workspace,
        session,
        baseWindow,
        workersWindow,
        minisWindow,
        proxyPort,
        fromIp,
        state,
        log,
      );
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
 * OC-LIMIT V2: three notifies + atomics (not oc-reset / Proxy-SMART / wait-ip).
 *   1) OC Restart Initialized
 *   2) stuck >30m → Reboot button toast
 *   3) new IP → kill CPE OC + revive opencode-cpe + CONTINUE
 */
function maybeRunOcLimitRecovery(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  workspace: string,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  proxyPort: number,
  fromIp: string | null,
  state: ConnectivityRecoveryState,
  log: (line: string) => void,
): void {
  const now = Date.now();
  if (state.recoveryRunning || ocLimitV2EpisodeActive()) return;
  if (state.rateLimitRecoveryStarted) return;
  if (state.lastRotateAt > 0 && now - state.lastRotateAt < ROTATE_COOLDOWN_MS) return;
  const stampLeft = ocLimitRecoveryCooldownLeftSec();
  if (stampLeft > 0) {
    state.rateLimitRecoveryStarted = true;
    log(`OC-LIMIT V2 skipped — shared stamp cooldown ${stampLeft}s`);
    return;
  }

  startOcLimitV2Episode({
    loaded,
    registry,
    workspace,
    session,
    baseWindow,
    workersWindow,
    minisWindow,
    proxyPort,
    fromIp,
    state,
    log,
  });
}

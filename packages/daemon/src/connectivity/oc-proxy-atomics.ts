/**
 * OC-LIMIT V2 atomics: record ses → kill CPE OpenCode → revive oc-proxy + CONTINUE.
 * Outside mesh-inbox/peer. Covers pia + zsign + seatmesh (shared CPE).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadProfile, type LoadedProfile, type ProviderRegistry } from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import {
  isOpenCodeCpeResumeCmd,
  listMeshMonitorPanes,
  loadLaunchState,
  resolveLaunchCmd,
  resolveLiveTmuxSession,
  seatAgentEntry,
  tryLaunchPane,
  tmux,
} from "@seat-mesh/tmux";
import { directInjectContinue, OC_PROXY_CONTINUE } from "./oc-relaunch.js";

const DEFAULT_SES_STAMP = "/tmp/seatmesh-oc-proxy-sessions.json";
const CONTINUE_WAIT_MS = 8_000;

/** Hub meshes that share the CPE proxy — all get kill→revive→CONTINUE on V2 success. */
export const OC_PROXY_MESH_ROOTS: ReadonlyArray<{ name: string; profile: string }> = [
  { name: "seatmesh", profile: "/home/dan/Desktop/Projects/seatmesh/.sm" },
  { name: "pia", profile: "/home/dan/Desktop/Work/pia/.sm" },
  { name: "zsign", profile: "/home/dan/Desktop/Work/zsign/.sm" },
];

export interface OcProxyAtomicSeat {
  mesh: string;
  label: string;
  paneId: string;
  ses: string | null;
  source: string;
  resume_cmd: string | null;
  type: string | null;
  workspace: string;
  profileDir: string;
}

export interface OcProxyAtomicsResult {
  recorded: number;
  killed: number;
  revived: number;
  continued: number;
  seats: OcProxyAtomicSeat[];
}

function wantOcProxy(
  entry: { type?: string; resume_cmd?: string | null } | null,
  paneId?: string,
): boolean {
  if (!entry) return false;
  // Honour operator-set skip flag — lets Cursor / non-oc panes survive atomics.
  if (paneId) {
    const skip = tmux(["show-options", "-p", "-t", paneId, "-v", "@mesh_atomics_skip"]).out?.trim();
    if (skip === "1" || skip === "true") return false;
  }
  if (entry.type === "oc-proxy") return true;
  return isOpenCodeCpeResumeCmd(entry.resume_cmd);
}

function paneSes(
  paneId: string,
  entry: { resume_id?: string | null } | null,
): { ses: string | null; source: string } {
  const tag = tmux(["show-options", "-p", "-t", paneId, "-v", "@mesh_oc_session"]).out;
  if (tag?.startsWith("ses_")) return { ses: tag, source: "tag" };
  const resume = entry?.resume_id?.trim();
  if (resume?.startsWith("ses_")) return { ses: resume, source: "mesh-agents" };
  return { ses: null, source: "none" };
}

function tryLoadMesh(profileDir: string): LoadedProfile | null {
  try {
    if (!fs.existsSync(profileDir) && !fs.existsSync(path.join(profileDir, "mesh.config.yaml"))) {
      return null;
    }
    return loadProfile(profileDir);
  } catch {
    return null;
  }
}

/** Snapshot oc-proxy seats on one mesh. */
export function recordOcProxySeats(
  loaded: LoadedProfile,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  opts: { mesh?: string; profileDir?: string; stampPath?: string } = {},
): OcProxyAtomicSeat[] {
  const state = loadLaunchState(loaded);
  const panes = listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow);
  const mesh = opts.mesh ?? loaded.profile.name ?? "mesh";
  const profileDir = opts.profileDir ?? loaded.profileDir;
  const seats: OcProxyAtomicSeat[] = [];
  for (const p of panes) {
    if (!p.label) continue;
    const entry = seatAgentEntry(loaded, p.label, state);
    if (!wantOcProxy(entry, p.paneId)) continue;
    const { ses, source } = paneSes(p.paneId, entry);
    seats.push({
      mesh,
      label: p.label,
      paneId: p.paneId,
      ses,
      source,
      resume_cmd: entry?.resume_cmd ?? null,
      type: entry?.type ?? null,
      workspace: loaded.workspace,
      profileDir,
    });
  }
  const stampPath = opts.stampPath ?? process.env.OC_PROXY_SES_STAMP ?? DEFAULT_SES_STAMP;
  if (stampPath !== "/dev/null") {
    try {
      fs.writeFileSync(
        stampPath,
        JSON.stringify(
          { at: new Date().toISOString(), workspace: loaded.workspace, session, seats },
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      /* best-effort */
    }
  }
  return seats;
}

/**
 * Record oc-proxy seats across pia + zsign + seatmesh (shared CPE).
 * Dedupes by paneId. Always includes the triggering mesh even if not in the hub list.
 */
export function recordAllMeshesOcProxySeats(
  trigger?: LoadedProfile,
  log?: (line: string) => void,
): OcProxyAtomicSeat[] {
  const byPane = new Map<string, OcProxyAtomicSeat>();
  const roots = [...OC_PROXY_MESH_ROOTS];
  if (trigger?.profileDir) {
    const abs = path.resolve(trigger.profileDir);
    if (!roots.some((r) => path.resolve(r.profile) === abs)) {
      roots.push({ name: trigger.profile.name || "local", profile: abs });
    }
  }

  for (const root of roots) {
    const loaded = tryLoadMesh(root.profile);
    if (!loaded) {
      log?.(`OC-ATOMICS skip mesh=${root.name}: profile missing`);
      continue;
    }
    const layout = loaded.profile.layout;
    if (!layout?.base?.window) {
      log?.(`OC-ATOMICS skip mesh=${root.name}: no layout`);
      continue;
    }
    let session: string;
    try {
      session = resolveLiveTmuxSession(loaded);
    } catch (e) {
      log?.(`OC-ATOMICS skip mesh=${root.name}: ${(e as Error).message}`);
      continue;
    }
    const seats = recordOcProxySeats(
      loaded,
      session,
      layout.base.window,
      layout.workers?.window ?? "workers",
      layout.minis?.window ?? "minis",
      { mesh: root.name, profileDir: root.profile, stampPath: "/dev/null" },
    );
    for (const s of seats) byPane.set(s.paneId, s);
    log?.(`OC-ATOMICS record ${root.name} n=${seats.length} session=${session}`);
  }

  const all = [...byPane.values()];
  try {
    fs.writeFileSync(
      process.env.OC_PROXY_SES_STAMP || DEFAULT_SES_STAMP,
      JSON.stringify({ at: new Date().toISOString(), seats: all }, null, 2),
      "utf8",
    );
  } catch {
    /* */
  }
  return all;
}

/** Disable leftover OC mouse/focus modes so CSI reports don't poison zsh. */
function resetPaneShell(paneId: string): void {
  tmux(["send-keys", "-t", paneId, "C-c"]);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  spawnSync("sleep", ["0.12"]);
  tmux([
    "send-keys",
    "-t",
    paneId,
    "-l",
    "printf '\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1006l\\033[?1004l\\033[?2004l' 2>/dev/null; stty sane 2>/dev/null; printf '\\r\\033[2K'",
  ]);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  spawnSync("sleep", ["0.12"]);
  tmux(["send-keys", "-t", paneId, "C-u"]);
}

/** Kill CPE-proxied opencode whose --session matches stamped ses (never whole-host wipe). */
export function killOcProxySeats(
  seats: OcProxyAtomicSeat[],
  proxyPort: number = 18887,
  log?: (line: string) => void,
): number {
  const wantSes = new Set(seats.map((s) => s.ses).filter(Boolean) as string[]);
  const portTok = String(proxyPort);
  let killed = 0;
  const pids = (spawnSync("pgrep", ["-f", "[o]pencode"], { encoding: "utf8" }).stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const pid of pids) {
    let env = "";
    let cmd = "";
    try {
      env = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch {
      continue;
    }
    if (!env.includes(portTok) && !env.includes(`:${portTok}`)) continue;
    const ses = (cmd.match(/ses_[A-Za-z0-9]+/) || [])[0];
    if (wantSes.size > 0 && (!ses || !wantSes.has(ses))) continue;
    try {
      process.kill(Number(pid), "SIGTERM");
      killed += 1;
      log?.(`OC-ATOMICS kill pid=${pid} ses=${ses ?? "?"}`);
    } catch {
      /* */
    }
  }
  spawnSync("sleep", ["1"]);
  for (const s of seats) {
    resetPaneShell(s.paneId);
  }
  return killed;
}

const loadedCache = new Map<string, LoadedProfile>();

function loadedForSeat(seat: OcProxyAtomicSeat): LoadedProfile | null {
  const key = seat.profileDir || seat.workspace;
  const hit = loadedCache.get(key);
  if (hit) return hit;
  const loaded = tryLoadMesh(seat.profileDir) ?? tryLoadMesh(path.join(seat.workspace, ".sm"));
  if (loaded) loadedCache.set(key, loaded);
  return loaded;
}

/**
 * Relaunch every stamped seat as oc-proxy (keep ses). Uses each seat's own mesh profile.
 * Returns paneIds that launched — CONTINUE must hit 100% of these.
 */
export function reviveOcProxySeats(
  _triggerLoaded: LoadedProfile | null,
  seats: OcProxyAtomicSeat[],
  log?: (line: string) => void,
): { revived: number; paneIds: string[]; failed: string[] } {
  let revived = 0;
  const paneIds: string[] = [];
  const failed: string[] = [];
  for (const s of seats) {
    if (!s.ses) {
      log?.(`OC-ATOMICS revive skip ${s.mesh}/${s.label}: no ses`);
      failed.push(`${s.mesh}/${s.label}:no-ses`);
      continue;
    }
    const loaded = loadedForSeat(s);
    if (!loaded) {
      log?.(`OC-ATOMICS revive fail ${s.mesh}/${s.label}: no profile`);
      failed.push(`${s.mesh}/${s.label}:no-profile`);
      continue;
    }
    const cmd =
      resolveLaunchCmd(
        {
          type: "oc-proxy",
          resume_id: s.ses,
          resume_cmd: s.resume_cmd,
        },
        loaded.workspace,
        loaded,
      ) ?? null;
    if (!cmd || !/opencode-cpe\.sh/.test(cmd)) {
      log?.(`OC-ATOMICS revive fail ${s.mesh}/${s.label}: not oc-proxy wrapper`);
      failed.push(`${s.mesh}/${s.label}:not-cpe`);
      continue;
    }
    const result = tryLaunchPane(loaded, s.paneId, s.label, cmd, false, "oc-proxy");
    if (result.status !== "launched") {
      log?.(
        `OC-ATOMICS revive fail ${s.mesh}/${s.label} ${s.paneId}: ${result.reason ?? result.status}`,
      );
      failed.push(`${s.mesh}/${s.label}:${result.reason ?? result.status}`);
      continue;
    }
    tmux(["set-option", "-p", "-t", s.paneId, "@mesh_oc_session", s.ses]);
    revived += 1;
    paneIds.push(s.paneId);
    log?.(`OC-ATOMICS revive ${s.mesh}/${s.label} ${s.paneId} ses=${s.ses}`);
  }
  return { revived, paneIds, failed };
}

/** Direct CONTINUE into revived panes — retries once per miss. */
export function continueOcProxySeats(
  registry: ProviderRegistry,
  paneIds: string[],
  log?: (line: string) => void,
): { continued: number; missed: string[] } {
  let n = 0;
  const missed: string[] = [];
  for (const paneId of paneIds) {
    let ok = directInjectContinue(registry, paneId, OC_PROXY_CONTINUE);
    if (!ok) {
      spawnSync("sleep", ["2"]);
      ok = directInjectContinue(registry, paneId, OC_PROXY_CONTINUE);
    }
    if (ok) {
      n += 1;
      log?.(`OC-ATOMICS CONTINUE direct ${paneId}`);
    } else {
      missed.push(paneId);
      log?.(`OC-ATOMICS CONTINUE miss ${paneId}`);
    }
  }
  return { continued: n, missed };
}

export interface OcProxyAtomicsRoundtripInput {
  loaded: LoadedProfile;
  registry: ProviderRegistry | null;
  session: string;
  baseWindow: string;
  workersWindow: string;
  minisWindow: string;
  proxyPort?: number;
  log?: (line: string) => void;
  waitAndContinue?: boolean;
  /** When true (default), record/revive pia+zsign+seatmesh. */
  allMeshes?: boolean;
}

/**
 * Full V2 atomic across hub meshes: record → kill → revive → CONTINUE.
 */
export function runOcProxyAtomicsRoundtrip(
  input: OcProxyAtomicsRoundtripInput,
): OcProxyAtomicsResult {
  const {
    loaded,
    registry,
    session,
    baseWindow,
    workersWindow,
    minisWindow,
    proxyPort = 18887,
    log,
    waitAndContinue = true,
    allMeshes = true,
  } = input;

  const seats = allMeshes
    ? recordAllMeshesOcProxySeats(loaded, log)
    : recordOcProxySeats(loaded, session, baseWindow, workersWindow, minisWindow, {
        mesh: loaded.profile.name,
        profileDir: loaded.profileDir,
      });
  log?.(`OC-ATOMICS record ${seats.length} oc-proxy seats (allMeshes=${allMeshes})`);
  const killed = killOcProxySeats(seats, proxyPort, log);
  spawnSync("sleep", ["2"]);
  const { revived, paneIds } = reviveOcProxySeats(loaded, seats, log);

  let continued = 0;
  if (waitAndContinue && paneIds.length > 0) {
    spawnSync("sleep", [String(Math.ceil(CONTINUE_WAIT_MS / 1000))]);
    const reg = registry ?? createRegistryForProfile(loaded.profile);
    continued = continueOcProxySeats(reg, paneIds, log).continued;
  }

  return {
    recorded: seats.length,
    killed,
    revived,
    continued,
    seats,
  };
}

/**
 * Async variant — does not block the daemon event loop on the CONTINUE wait.
 */
export function runOcProxyAtomicsRoundtripAsync(
  input: OcProxyAtomicsRoundtripInput,
  onDone: (result: OcProxyAtomicsResult) => void,
): void {
  const { loaded, registry, proxyPort = 18887, log, allMeshes = true } = input;
  const seats = allMeshes
    ? recordAllMeshesOcProxySeats(loaded, log)
    : recordOcProxySeats(
        loaded,
        input.session,
        input.baseWindow,
        input.workersWindow,
        input.minisWindow,
        { mesh: loaded.profile.name, profileDir: loaded.profileDir },
      );
  log?.(`OC-ATOMICS record ${seats.length} oc-proxy seats`);
  const killed = killOcProxySeats(seats, proxyPort, log);
  setTimeout(() => {
    const { revived, paneIds } = reviveOcProxySeats(loaded, seats, log);
    if (paneIds.length === 0) {
      onDone({ recorded: seats.length, killed, revived, continued: 0, seats });
      return;
    }
    setTimeout(() => {
      const reg = registry ?? createRegistryForProfile(loaded.profile);
      const { continued } = continueOcProxySeats(reg, paneIds, log);
      onDone({ recorded: seats.length, killed, revived, continued, seats });
    }, CONTINUE_WAIT_MS);
  }, 2000);
}

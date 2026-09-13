import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  MESH_SECRETARY_PREFIX,
  meshRuntimePaths,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import {
  loadAgentsState,
  loadMeshAgents,
  miniStateForN,
  resolveLaunchCmd,
} from "../agents/agents-state.js";
import { buildAgentLaunchCmd } from "../agents/agent-builder.js";
import { launchSession, tryLaunchPane } from "../agents/launch.js";
import { resolveMiniPaneId } from "../session/window-panes.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { injectPromptDirect } from "../inject/prompt.js";
import { enqueueColdStart } from "../seats/cold-start-inject.js";
import { tmux } from "../lib/tmux-run.js";

const SECRETARY_PREFIX = MESH_SECRETARY_PREFIX;
const SUPERVISOR_PREFIX = "[mesh-supervisor] ";

export interface MiniManifestEntry {
  id: number;
  role: string;
  hub: string;
  task: string;
}

export interface MiniManifest {
  campaign: string;
  supervisor: string;
  minis: MiniManifestEntry[];
}

export interface MiniRow {
  id: number;
  paneId: string;
  job_role: string;
  status: "idle" | "spawned" | "done" | "failed";
  hub: string;
  task: string;
  spawnedAt?: string;
  doneAt?: string;
  report?: string;
}

export interface MinisStateFile {
  campaign?: string;
  supervisor?: string;
  updatedAt?: string;
  minis: Record<string, MiniRow>;
}

function minisStatePath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).minisJson;
}

function miniDonePath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).miniDone;
}

function manifestPath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).miniManifest;
}

export function loadMinisState(loaded: LoadedProfile): MinisStateFile {
  const p = minisStatePath(loaded);
  if (!fs.existsSync(p)) {
    return { minis: {} };
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as MinisStateFile;
}

export function saveMinisState(loaded: LoadedProfile, state: MinisStateFile): void {
  const p = minisStatePath(loaded);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

export function loadMiniManifest(loaded: LoadedProfile): MiniManifest {
  const p = manifestPath(loaded);
  if (!fs.existsSync(p)) {
    throw new Error(`missing ${p} — supervisor must write mini-manifest.json first`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as MiniManifest;
}

function miniPaneId(loaded: LoadedProfile, n: number): string | null {
  const layout = loaded.profile.layout;
  if (!layout) return null;
  return resolveMiniPaneId(
    loaded.sessionName,
    layout.minis.window,
    n,
  );
}

function resolveMiniHarnessType(savedType: string | undefined, miniCli: string): string {
  if (!savedType || savedType === "empty") return miniCli;
  return savedType === "cursor-agent" ? "agent" : savedType;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

function ensureMiniCli(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  n: number,
): string {
  const paneId = miniPaneId(loaded, n);
  if (!paneId) throw new Error(`mini-${n} pane missing`);

  const snap = capturePaneSnapshot(paneId);
  const live = snap ? registry.detect(snap) : null;

  if (!live) {
    const agents = loadAgentsState(loaded.workspace, loaded.profile.state.agentsJson);
    const mesh = loadMeshAgents(loaded.workspace, loaded.profile.state.meshAgentsJson);
    const saved = mesh ? miniStateForN(mesh, n) : undefined;
    const miniCli =
      agents.conventions?.mini_default_cli ??
      agents.conventions?.secretary_default_cli ??
      "opencode";
    const type = resolveMiniHarnessType(saved?.type, miniCli);
    const entry = {
      type,
      resume_id: saved?.resumeId ?? null,
      resume_cmd: saved?.resumeCmd ?? null,
    };
    const cmd =
      resolveLaunchCmd(entry, loaded.workspace) ??
      buildAgentLaunchCmd(type, loaded.workspace, entry.resume_id);
    if (!cmd) throw new Error(`no launch cmd for mini type ${type}`);
    const launched = tryLaunchPane(loaded, paneId, `mini-${n}`, cmd, false, type);
    if (launched.status !== "launched") {
      throw new Error(
        launched.reason ??
          `mini-${n} pane ${paneId} failed to start CLI — still plain_shell`,
      );
    }
  }
  return paneId;
}

export function listMinis(loaded: LoadedProfile): MiniRow[] {
  const state = loadMinisState(loaded);
  const max = loaded.profile.session.miniMax;
  const rows: MiniRow[] = [];
  for (let n = 1; n <= max; n++) {
    const key = String(n);
    const paneId = miniPaneId(loaded, n) ?? "?";
    const saved = state.minis[key];
    if (saved) {
      rows.push({ ...saved, paneId: saved.paneId || paneId });
    } else {
      rows.push({
        id: n,
        paneId,
        job_role: "-",
        status: "idle",
        hub: "-",
        task: "",
      });
    }
  }
  return rows;
}

export interface MiniCampaignDigest {
  campaign: string;
  done: number;
  open: number;
  failed: number;
  total: number;
  allDone: boolean;
  openIds: number[];
  recentDone: string[];
  text: string;
}

/** Rows that belong to the active campaign (not phantom idle slots 1..miniMax). */
function campaignMiniRows(loaded: LoadedProfile): MiniRow[] {
  const state = loadMinisState(loaded);
  const tracked = new Set(Object.keys(state.minis).map((k) => Number(k)));
  let manifestIds: number[] | null = null;
  try {
    manifestIds = loadMiniManifest(loaded).minis.map((m) => m.id);
  } catch {
    /* no manifest — tracked state only */
  }
  const scope = new Set<number>(tracked);
  if (manifestIds) {
    for (const id of manifestIds) {
      if (tracked.has(id)) scope.add(id);
    }
  }
  if (scope.size === 0) return [];
  return listMinis(loaded).filter((r) => scope.has(r.id));
}

/** Mechanical campaign status — secretary must not invent "all done" without this. */
export function buildMiniCampaignDigest(loaded: LoadedProfile): MiniCampaignDigest {
  const state = loadMinisState(loaded);
  const rows = campaignMiniRows(loaded);
  const total = rows.length || Object.keys(state.minis).length;
  let done = 0;
  let open = 0;
  let failed = 0;
  const openIds: number[] = [];
  for (const r of rows) {
    if (r.status === "done") done++;
    else if (r.status === "failed") failed++;
    else {
      open++;
      openIds.push(r.id);
    }
  }
  const allDone = total > 0 && open === 0 && failed === 0 && done >= total;

  const donePath = miniDonePath(loaded);
  let recentDone: string[] = [];
  if (fs.existsSync(donePath)) {
    recentDone = fs
      .readFileSync(donePath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("mini-"))
      .slice(-8);
  }

  const lines = [
    `CAMPAIGN ${state.campaign ?? "?"}: ${done}/${total} done, ${open} open, ${failed} failed`,
    allDone ? "STATUS: COMPLETE (mechanical)" : `STATUS: INCOMPLETE — open mini(s): ${openIds.join(", ") || "none"}`,
    "",
    "Recent MINI-DONE:",
    ...(recentDone.length ? recentDone : ["(none)"]),
  ];
  if (openIds.length) {
    lines.push("", "Still spawned (no done or stale):");
    for (const id of openIds) {
      const r = rows.find((x) => x.id === id);
      lines.push(`  mini-${id} hub=${r?.hub ?? "?"} ${(r?.task ?? "").slice(0, 100)}`);
    }
  }

  return {
    campaign: state.campaign ?? "?",
    done,
    open,
    failed,
    total,
    allDone,
    openIds,
    recentDone,
    text: lines.join("\n"),
  };
}

export function printMiniList(loaded: LoadedProfile): void {
  for (const r of listMinis(loaded)) {
    console.log(
      `mini-${r.id}\t${r.paneId}\t${r.status}\trole=${r.job_role}\thub=${r.hub}\t${r.task.slice(0, 72)}`,
    );
  }
}

export interface MiniSpawnOptions {
  /** Secretary inject prefix (default true for dispatch). */
  viaSecretary?: boolean;
  hub?: string;
  skipState?: boolean;
}

export function miniSpawn(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  n: number,
  role: string,
  task: string,
  opts: MiniSpawnOptions = {},
): void {
  if (n < 1 || n > loaded.profile.session.miniMax) {
    throw new Error(`mini id must be 1-${loaded.profile.session.miniMax}`);
  }

  const paneId = ensureMiniCli(loaded, registry, n);
  const prefix = opts.viaSecretary === false ? SUPERVISOR_PREFIX : SECRETARY_PREFIX;
  const brief = `${prefix}FRESH SUMMON. First action: run ./sm.sh whoami (no flags). Then this task.
MINI-TASK id=${n} role=${role}: ${task}

You are mini-${n} (NOT a worker seat). Parallel job for manager only. When done: report via mini done ${n} PASS|FAIL: <evidence>. Then stop.`;

  injectPromptDirect(loaded, registry, `mini-${n}`, brief, {
    prefix: "",
    confirmSent: false,
  });
  try {
    enqueueColdStart(loaded, `mini-${n}`, { mini: String(n) });
  } catch {
    /* whoami embeds cold-start if enqueue fails */
  }

  if (!opts.skipState) {
    const state = loadMinisState(loaded);
    state.campaign = state.campaign ?? "sm-parity";
    state.minis[String(n)] = {
      id: n,
      paneId,
      job_role: role,
      status: "spawned",
      hub: opts.hub ?? "-",
      task,
      spawnedAt: new Date().toISOString(),
    };
    saveMinisState(loaded, state);
  }

  console.log(`OK: spawned mini-${n} role=${role} pane=${paneId}`);
}

export function miniPrompt(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  n: number,
  text: string,
): void {
  injectPromptDirect(loaded, registry, `mini-${n}`, text, { prefix: SECRETARY_PREFIX });
  console.log(`OK: prompt mini-${n}`);
}

export function miniDone(
  loaded: LoadedProfile,
  n: number,
  report: string,
): void {
  const state = loadMinisState(loaded);
  const key = String(n);
  const row = state.minis[key];
  const paneId = miniPaneId(loaded, n) ?? row?.paneId ?? "?";
  const line = `${new Date().toISOString()} mini-${n} ${report}`;
  fs.mkdirSync(path.dirname(miniDonePath(loaded)), { recursive: true });
  fs.appendFileSync(miniDonePath(loaded), line + "\n");

  state.minis[key] = {
    id: n,
    paneId,
    job_role: row?.job_role ?? "?",
    status: report.trim().toUpperCase().startsWith("PASS") ? "done" : "failed",
    hub: row?.hub ?? "-",
    task: row?.task ?? "",
    spawnedAt: row?.spawnedAt,
    doneAt: new Date().toISOString(),
    report,
  };
  saveMinisState(loaded, state);

  const mgr = resolvePaneTarget("manager", loaded);
  if (!("error" in mgr)) {
    tmux([
      "display-message",
      "-t",
      mgr.paneId,
      `MINI-DONE mini-${n}: ${report.slice(0, 120)}`,
    ]);
  }

  console.log(`OK: mini done ${n} — ${report.slice(0, 80)}`);
}

export function miniSpawnAll(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  manifest?: MiniManifest,
): void {
  const m = manifest ?? loadMiniManifest(loaded);
  const state = loadMinisState(loaded);
  state.campaign = m.campaign;
  state.supervisor = m.supervisor;
  saveMinisState(loaded, state);

  launchSession(loaded, { targets: ["minis"] });
  sleepMs(5000);

  const max = loaded.profile.layout?.minis.max ?? loaded.profile.session.miniMax;
  let dispatched = 0;
  for (const entry of m.minis) {
    if (entry.id > max) {
      console.log(`SKIP mini-${entry.id}: profile max=${max} (${loaded.profile.layout?.minis.grid ?? "grid"})`);
      continue;
    }
    try {
      miniSpawn(loaded, registry, entry.id, entry.role, entry.task, {
        viaSecretary: true,
        hub: entry.hub,
      });
      dispatched++;
      sleepMs(800);
    } catch (e) {
      console.error(`FAIL mini-${entry.id}: ${(e as Error).message}`);
    }
  }
  console.log(`--- dispatched ${dispatched}/${m.minis.length} minis campaign=${m.campaign} max=${max}`);
}

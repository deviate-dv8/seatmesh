/**
 * Swap two worker or mini seats.
 *
 * Default (visual): `tmux swap-pane` only. Labels / resume / seats travel with
 * the pane — session data stays correct; agents trade screen location.
 *
 * `--identity`: exchange slot numbers + seat dirs + mesh-agents / minis.json
 * rows so peer addresses swap while each agent keeps FOCUS/TASKS/resume.
 * Ports restamp to the new number (running process may still hold old ports
 * until switch/respawn).
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildResolvedPaths,
  normalizeMinisLeads,
  type LoadedProfile,
  type MeshAgents,
  type MiniSlot,
  type WorkerSlot,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { stampMiniId, stampWorkerSlot } from "../session/labels.js";
import { applyMeshSessionBorders } from "../session/borders.js";
import { activeSessionWindows } from "../session/session-windows.js";
import { saveMeshAgentsFile, saveMeshSession } from "../session/save-session.js";
import { meshAgentsJsonPath, loadMeshAgentsForProfile } from "./agents-state.js";
import { seatDirFor } from "../seats/seat-paths.js";
import { loadMinisState, saveMinisState } from "../roles/minis.js";

export type SwapKind = "worker" | "mini";

export interface SwapSeatOpts {
  /** Exchange logical ids + seat dirs + mesh-agents (default: visual only). */
  identity?: boolean;
}

export interface SwapSeatResult {
  kind: SwapKind;
  a: string;
  b: string;
  mode: "visual" | "identity";
  paneA: string;
  paneB: string;
}

export function parseSwapTarget(
  raw: string,
): { kind: SwapKind; n: number; label: string } {
  const t = raw.trim().toLowerCase();
  const mini = t.match(/^(?:mini|manager-mini)-?(\d+)$/);
  if (mini) {
    const n = Number(mini[1]);
    if (!Number.isFinite(n) || n < 1) throw new Error(`swap: bad mini ${raw}`);
    return { kind: "mini", n, label: `mini-${n}` };
  }
  const slot = t.match(/^(?:slot-|worker-)?(\d+)$/);
  if (slot) {
    const n = Number(slot[1]);
    if (!Number.isFinite(n) || n < 1) throw new Error(`swap: bad slot ${raw}`);
    return { kind: "worker", n, label: `slot-${n}` };
  }
  throw new Error(`swap: want slot-N|worker-N|mini-N (got ${raw})`);
}

/** Atomic dir exchange (handles missing sides). */
export function swapDirsAtomic(dirA: string, dirB: string): void {
  if (!fs.existsSync(dirA) && !fs.existsSync(dirB)) return;
  const parent = path.dirname(dirA);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = path.join(
    parent,
    `.swap-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  if (fs.existsSync(dirA) && fs.existsSync(dirB)) {
    fs.renameSync(dirA, tmp);
    fs.renameSync(dirB, dirA);
    fs.renameSync(tmp, dirB);
    return;
  }
  if (fs.existsSync(dirA) && !fs.existsSync(dirB)) {
    fs.renameSync(dirA, dirB);
    return;
  }
  if (!fs.existsSync(dirA) && fs.existsSync(dirB)) {
    fs.renameSync(dirB, dirA);
  }
}

function swapChatfileDirs(loaded: LoadedProfile, kind: SwapKind, n: number, m: number): void {
  const root = buildResolvedPaths(loaded).chatFilesRoot;
  if (!root || !fs.existsSync(root)) return;
  const a = path.join(root, kind === "worker" ? `worker-${n}` : `mini-${n}`);
  const b = path.join(root, kind === "worker" ? `worker-${m}` : `mini-${m}`);
  swapDirsAtomic(a, b);
}

/** Exchange agent content between two slot numbers (ports stay with the number). */
export function patchMeshAgentsIdentity(
  mesh: MeshAgents,
  kind: SwapKind,
  n: number,
  m: number,
): MeshAgents {
  const next = structuredClone(mesh);
  if (kind === "worker") {
    const ia = next.workers.findIndex((w) => w.slot === n);
    const ib = next.workers.findIndex((w) => w.slot === m);
    const empty = (slot: number): WorkerSlot => ({
      slot,
      type: "empty",
      name: `worker-${slot}`,
      resumeId: null,
      resumeCmd: null,
    });
    const a = ia >= 0 ? next.workers[ia]! : empty(n);
    const b = ib >= 0 ? next.workers[ib]! : empty(m);
    const swappedA: WorkerSlot = {
      ...a,
      type: b.type,
      resumeId: b.resumeId,
      resumeCmd: b.resumeCmd,
      name: `worker-${n}`,
      slot: n,
    };
    const swappedB: WorkerSlot = {
      ...b,
      type: a.type,
      resumeId: a.resumeId,
      resumeCmd: a.resumeCmd,
      name: `worker-${m}`,
      slot: m,
    };
    next.workers = next.workers.filter((w) => w.slot !== n && w.slot !== m);
    next.workers.push(swappedA, swappedB);
    next.workers.sort((x, y) => x.slot - y.slot);
  } else {
    const ia = next.minis.findIndex((x) => x.mini === n);
    const ib = next.minis.findIndex((x) => x.mini === m);
    const empty = (mini: number): MiniSlot => ({
      mini,
      type: "empty",
      name: `mini-${mini}`,
      resumeId: null,
      resumeCmd: null,
    });
    const a = ia >= 0 ? next.minis[ia]! : empty(n);
    const b = ib >= 0 ? next.minis[ib]! : empty(m);
    const swappedA: MiniSlot = {
      ...a,
      type: b.type,
      resumeId: b.resumeId,
      resumeCmd: b.resumeCmd,
      role: b.role,
      task: b.task,
      name: `mini-${n}`,
      mini: n,
    };
    const swappedB: MiniSlot = {
      ...b,
      type: a.type,
      resumeId: a.resumeId,
      resumeCmd: a.resumeCmd,
      role: a.role,
      task: a.task,
      name: `mini-${m}`,
      mini: m,
    };
    next.minis = next.minis.filter((x) => x.mini !== n && x.mini !== m);
    next.minis.push(swappedA, swappedB);
    next.minis.sort((x, y) => x.mini - y.mini);
  }
  return next;
}

function swapMinisJsonRows(loaded: LoadedProfile, n: number, m: number): void {
  const state = loadMinisState(loaded);
  const ka = String(n);
  const kb = String(m);
  const ra = state.minis[ka];
  const rb = state.minis[kb];
  if (!ra && !rb) return;
  if (ra && rb) {
    state.minis[ka] = { ...rb, id: n, paneId: ra.paneId };
    state.minis[kb] = { ...ra, id: m, paneId: rb.paneId };
  } else if (ra && !rb) {
    state.minis[kb] = { ...ra, id: m };
    delete state.minis[ka];
  } else if (!ra && rb) {
    state.minis[ka] = { ...rb, id: n };
    delete state.minis[kb];
  }
  saveMinisState(loaded, state);
}

/**
 * Swap two seats. Same tier only (worker↔worker or mini↔mini).
 */
export function runSeatSwap(
  loaded: LoadedProfile,
  rawA: string,
  rawB: string,
  opts: SwapSeatOpts = {},
): SwapSeatResult {
  const a = parseSwapTarget(rawA);
  const b = parseSwapTarget(rawB);
  if (a.kind !== b.kind) {
    throw new Error(
      `swap: cross-tier refused (${a.label} ↔ ${b.label}) — worker↔worker or mini↔mini only`,
    );
  }
  if (a.n === b.n) throw new Error(`swap: ${a.label} is the same seat`);

  const resolvedA = resolvePaneTarget(a.label, loaded);
  const resolvedB = resolvePaneTarget(b.label, loaded);
  if ("error" in resolvedA) throw new Error(resolvedA.error);
  if ("error" in resolvedB) throw new Error(resolvedB.error);
  if (resolvedA.paneId === resolvedB.paneId) {
    throw new Error(`swap: both resolve to ${resolvedA.paneId}`);
  }
  if (resolvedA.row.window !== resolvedB.row.window) {
    throw new Error(
      `swap: panes must share a window (${resolvedA.row.window} vs ${resolvedB.row.window})`,
    );
  }

  const identity = Boolean(opts.identity);

  if (!identity) {
    const r = tmux([
      "swap-pane",
      "-d",
      "-s",
      resolvedA.paneId,
      "-t",
      resolvedB.paneId,
    ]);
    if (!r.ok) throw new Error(`swap-pane failed: ${r.err || r.out}`);
    try {
      saveMeshSession(loaded, createRegistryForProfile(loaded.profile));
    } catch {
      /* non-fatal */
    }
    applyMeshSessionBorders(loaded.sessionName, activeSessionWindows(loaded, loaded.sessionName));
    return {
      kind: a.kind,
      a: a.label,
      b: b.label,
      mode: "visual",
      paneA: resolvedA.paneId,
      paneB: resolvedB.paneId,
    };
  }

  // --- identity: process keeps screen cell; numbers + seat data exchange ---
  const seatA = seatDirFor(
    loaded,
    a.kind === "worker"
      ? { role: "worker", slot: String(a.n) }
      : { role: "manager-mini", mini: String(a.n) },
  );
  const seatB = seatDirFor(
    loaded,
    b.kind === "worker"
      ? { role: "worker", slot: String(b.n) }
      : { role: "manager-mini", mini: String(b.n) },
  );
  if (seatA && seatB) swapDirsAtomic(seatA, seatB);
  swapChatfileDirs(loaded, a.kind, a.n, b.n);

  const mesh = loadMeshAgentsForProfile(loaded);
  if (mesh) {
    saveMeshAgentsFile(
      meshAgentsJsonPath(loaded),
      patchMeshAgentsIdentity(mesh, a.kind, a.n, b.n),
    );
  }
  if (a.kind === "mini") swapMinisJsonRows(loaded, a.n, b.n);

  const leads =
    a.kind === "mini" && loaded.profile.layout?.minis
      ? new Set(normalizeMinisLeads(loaded.profile.layout.minis.leads).map(String))
      : null;
  if (a.kind === "worker") {
    stampWorkerSlot(loaded, resolvedA.paneId, b.n);
    stampWorkerSlot(loaded, resolvedB.paneId, a.n);
  } else {
    stampMiniId(loaded, resolvedA.paneId, b.n, leads?.has(String(b.n)) ?? false);
    stampMiniId(loaded, resolvedB.paneId, a.n, leads?.has(String(a.n)) ?? false);
  }

  try {
    saveMeshSession(loaded, createRegistryForProfile(loaded.profile));
  } catch {
    /* non-fatal — labels + seats already swapped */
  }
  applyMeshSessionBorders(loaded.sessionName, activeSessionWindows(loaded, loaded.sessionName));

  return {
    kind: a.kind,
    a: a.label,
    b: b.label,
    mode: "identity",
    paneA: resolvedA.paneId,
    paneB: resolvedB.paneId,
  };
}

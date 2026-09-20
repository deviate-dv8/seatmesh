import fs from "node:fs";
import path from "node:path";
import {
  MeshAgentsSchema,
  buildResolvedPaths,
  entryWantsProxyRecovery,
  resumeCmdMatchesKindProve,
  runnersFromProfile,
  seatKindFromId,
  type LoadedProfile,
  type MeshAgents,
} from "@seat-mesh/core";
import { resolveKindsForProfile } from "@seat-mesh/providers";
import type { PaneRow } from "../lib/resolve-pane.js";
import { buildLaunchCmdWithRunners } from "./agent-launch.js";
import {
  injectOpenCodeSessionIntoCmd,
  isOpenCodeCpeResumeCmd,
} from "../session/save-session.js";

/** Absolute path to mesh-agents.json (respects profile paths.scope). */
export function meshAgentsJsonPath(loaded: LoadedProfile): string {
  return buildResolvedPaths(loaded).meshAgentsJson;
}

/** Absolute path to legacy tmux-main-agents.json seed. */
export function agentsJsonPath(loaded: LoadedProfile): string {
  return buildResolvedPaths(loaded).agentsJson;
}

// ---------------------------------------------------------------------------
// Legacy harness state (tmux-main-agents.json) -- read-only compat layer.
// ---------------------------------------------------------------------------

export interface PaneAgentState {
  type: string;
  name?: string;
  role?: string;
  slot?: number;
  ports?: string;
  resume_id?: string | null;
  resume_cmd?: string | null;
}

export interface AgentsStateFile {
  panes: PaneAgentState[];
  manager?: PaneAgentState;
  /** Extra base columns from mesh-agents coords (any profile column id). */
  coords?: Record<string, PaneAgentState>;
  conventions?: {
    secretary_default_cli?: string;
    mini_default_cli?: string;
    launch_skips_empty?: boolean;
    coord_sync?: {
      reload?: boolean;
      attach?: boolean;
    };
  };
  secretary?: {
    type?: string;
    wanted?: boolean;
    resume_id?: string | null;
    resume_cmd?: string | null;
  };
}

export function loadAgentsStateAt(file: string): AgentsStateFile {
  if (!fs.existsSync(file)) {
    throw new Error(`agents state not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as AgentsStateFile;
}

/** @deprecated prefer loadAgentsStateAt(agentsJsonPath(loaded)) */
export function loadAgentsState(workspace: string, relPath: string): AgentsStateFile {
  const file = path.isAbsolute(relPath) ? relPath : path.join(workspace, relPath);
  return loadAgentsStateAt(file);
}

export function workerStateForSlot(
  state: AgentsStateFile,
  slot: number,
): PaneAgentState | undefined {
  return state.panes.find((p) => p.slot === slot);
}

export function miniStateForN(mesh: MeshAgents, n: number) {
  return mesh.minis.find((m) => m.mini === n);
}

export function meshSlotToPaneState(
  slot: {
    type: string;
    resumeId?: string | null;
    resumeCmd?: string | null;
    name?: string;
  },
  role?: string,
): PaneAgentState {
  return {
    type: slot.type,
    resume_id: slot.resumeId ?? null,
    resume_cmd: slot.resumeCmd ?? null,
    name: slot.name,
    role,
  };
}

/** Seat label for mesh state lookup (`manager`, `secretary-2`, `mini-3`, `slot-1`). */
export function seatIdFromPaneRow(row: PaneRow): string {
  if (row.mini && /^\d+$/.test(row.mini)) return `mini-${row.mini}`;
  if (row.role === "worker" && row.slot && /^\d+$/.test(row.slot)) return `slot-${row.slot}`;
  if (row.role) return row.role;
  if (row.slot && /^\d+$/.test(row.slot)) return `slot-${row.slot}`;
  return "";
}

/** Saved harness entry for any seat id — manager, secretary, coord, worker, mini. */
export function seatAgentEntry(
  loaded: LoadedProfile,
  seatId: string,
  state?: AgentsStateFile,
  mesh?: MeshAgents | null,
): PaneAgentState | null {
  const st = state ?? loadLaunchState(loaded);
  const kinds = loaded.profile.layout?.base.kinds;
  const kind = seatKindFromId(seatId, kinds);

  const meshState = (): MeshAgents | null =>
    mesh === undefined ? loadMeshAgentsForProfile(loaded) : mesh;

  if (kind === "secretary") {
    const s = st.secretary;
    if (!s) return null;
    return {
      type: s.type ?? "opencode",
      resume_id: s.resume_id ?? null,
      resume_cmd: s.resume_cmd ?? null,
      role: seatId,
    };
  }

  if (kind === "manager") {
    if (seatId === "manager" || seatId === "master") {
      if (!st.manager) return null;
      return { ...st.manager, role: "manager" };
    }
    const legacy = st.coords?.[seatId];
    if (legacy) return { ...legacy, role: seatId };
    const coord = meshState()?.coords?.[seatId];
    if (coord) return meshSlotToPaneState(coord, seatId);
    return null;
  }

  if (kind === "mini") {
    const n = Number(seatId.replace(/^mini-/, ""));
    const m = meshState();
    if (!n || !m) return null;
    const mini = miniStateForN(m, n);
    if (!mini) return null;
    return meshSlotToPaneState(mini, seatId);
  }

  if (kind === "worker") {
    const slot = Number(seatId.replace(/^slot-/, ""));
    if (!slot) return null;
    return workerStateForSlot(st, slot) ?? null;
  }

  return null;
}

/** @deprecated use buildProfileLaunchCmd / buildLaunchCmdWithRunners */
export function buildLaunchCmd(
  type: string,
  workspace: string,
  resumeId?: string | null,
  loaded?: LoadedProfile,
): string | null {
  const runners = loaded ? runnersFromProfile(loaded.profile) : {};
  return buildLaunchCmdWithRunners(type, workspace, resumeId, runners);
}

export function resolveLaunchCmd(
  entry: PaneAgentState,
  workspace: string,
  loaded?: LoadedProfile,
): string | null {
  const runners = loaded ? runnersFromProfile(loaded.profile) : {};
  const kinds = loaded ? resolveKindsForProfile(loaded.profile, loaded.profileDir) : undefined;
  const resumeId = entry.resume_id ?? null;
  if (entry.resume_cmd) {
    // Keep CPE (or any prove-kind) wrapper — only refresh --session. Prefer the
    // generic prove-pattern match (works for any onProxyUp kind, not just CPE);
    // the hardcoded regex is only a fallback for the caller-omitted-loaded case
    // (kinds undefined) — every live caller of resolveLaunchCmd passes loaded.
    if (
      kinds
        ? resumeCmdMatchesKindProve(entry.resume_cmd, kinds)
        : isOpenCodeCpeResumeCmd(entry.resume_cmd)
    ) {
      return injectOpenCodeSessionIntoCmd(entry.resume_cmd, resumeId);
    }
    // Recovery kind configured but resume_cmd lost the wrapper → rebuild from kinds
    if (kinds && entryWantsProxyRecovery(entry, kinds)) {
      return buildLaunchCmdWithRunners(entry.type, workspace, resumeId, runners, kinds);
    }
    return entry.resume_cmd;
  }
  return buildLaunchCmdWithRunners(entry.type, workspace, resumeId, runners, kinds);
}

// ---------------------------------------------------------------------------
// Mesh-owned state (mesh-agents.json) — read via loadMeshAgents; writes via save/set/tag.
// ---------------------------------------------------------------------------

/**
 * Load + validate mesh-agents.json via Zod. Returns null if file does not
 * exist (callers may fall back to legacy loadAgentsState).
 */
export function loadMeshAgentsAt(file: string): MeshAgents | null {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return MeshAgentsSchema.parse(raw);
}

export function loadMeshAgentsForProfile(loaded: LoadedProfile): MeshAgents | null {
  return loadMeshAgentsAt(meshAgentsJsonPath(loaded));
}

/** @deprecated prefer loadMeshAgentsForProfile(loaded) or loadMeshAgentsAt(absPath) */
export function loadMeshAgents(workspace: string, relPath: string): MeshAgents | null {
  const file = path.isAbsolute(relPath) ? relPath : path.join(workspace, relPath);
  return loadMeshAgentsAt(file);
}

/**
 * Adapter: mesh state -> legacy AgentsStateFile so launch.ts / scan
 * callers can use MeshAgents without rewriting their lookup logic today.
 */
export function meshToLegacyAgentsState(mesh: MeshAgents): AgentsStateFile {
  const panes = mesh.workers.map((w) => ({
    type: w.type,
    name: w.name,
    role: "worker" as const,
    slot: w.slot,
    ports: w.ports,
    resume_id: w.resumeId ?? null,
    resume_cmd: w.resumeCmd ?? null,
  }));

  const manager = mesh.manager
    ? {
        type: mesh.manager.type,
        name: mesh.manager.name,
        role: "manager" as const,
        resume_id: mesh.manager.resumeId ?? null,
        resume_cmd: mesh.manager.resumeCmd ?? null,
      }
    : undefined;

  const secretary = mesh.secretary
    ? {
        type: mesh.secretary.type,
        wanted: mesh.secretary.wanted,
        resume_id: mesh.secretary.resumeId ?? null,
        resume_cmd: mesh.secretary.resumeCmd ?? null,
      }
    : undefined;

  const coords: Record<string, PaneAgentState> = {};
  for (const [id, slot] of Object.entries(mesh.coords ?? {})) {
    coords[id] = {
      type: slot.type,
      name: slot.name ?? id,
      role: id,
      resume_id: slot.resumeId ?? null,
      resume_cmd: slot.resumeCmd ?? null,
    };
  }

  return {
    panes,
    manager,
    coords: Object.keys(coords).length ? coords : undefined,
    conventions: {
      secretary_default_cli: mesh.conventions.secretaryDefaultCli,
      mini_default_cli: mesh.conventions.miniDefaultCli,
      launch_skips_empty: mesh.conventions.launchSkipsEmpty,
      coord_sync: mesh.conventions.coordSync
        ? {
            reload: mesh.conventions.coordSync.reload,
            attach: mesh.conventions.coordSync.attach,
          }
        : undefined,
    },
    secretary,
  };
}

/** Launch/switch: prefer mesh-agents.json (saved resumeCmd) over legacy harness JSON. */
export function loadLaunchState(loaded: LoadedProfile): AgentsStateFile {
  const meshFile = meshAgentsJsonPath(loaded);
  const mesh = loadMeshAgentsAt(meshFile);
  if (mesh) return meshToLegacyAgentsState(mesh);
  const legacy = agentsJsonPath(loaded);
  if (fs.existsSync(legacy)) return loadAgentsStateAt(legacy);
  // Fresh init: mesh-agents.json may exist under corrected path; else empty seed.
  return {
    panes: [],
    conventions: {
      secretary_default_cli: "opencode",
      mini_default_cli: "opencode",
      launch_skips_empty: true,
    },
  };
}

/**
 * Load mesh state, falling back to legacy if mesh-agents.json absent.
 * Returns a tagged result so callers know which source was used.
 */
export function loadAgentsStateCompat(
  loaded: LoadedProfile,
): { source: "mesh"; state: MeshAgents } | { source: "legacy"; state: AgentsStateFile } {
  const mesh = loadMeshAgentsForProfile(loaded);
  if (mesh) return { source: "mesh", state: mesh };
  return { source: "legacy", state: loadAgentsStateAt(agentsJsonPath(loaded)) };
}

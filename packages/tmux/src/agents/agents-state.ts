import fs from "node:fs";
import path from "node:path";
import {
  MeshAgentsSchema,
  buildResolvedPaths,
  type LoadedProfile,
  type MeshAgents,
} from "@seat-mesh/core";
import { buildAgentLaunchCmd } from "./agent-builder.js";

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

/** @deprecated use buildAgentLaunchCmd from agent-builder.ts */
export function buildLaunchCmd(
  type: string,
  workspace: string,
  resumeId?: string | null,
): string | null {
  return buildAgentLaunchCmd(type, workspace, resumeId);
}

export function resolveLaunchCmd(
  entry: PaneAgentState,
  workspace: string,
): string | null {
  if (entry.resume_id) {
    return buildLaunchCmd(entry.type, workspace, entry.resume_id);
  }
  if (entry.resume_cmd) return entry.resume_cmd;
  return buildLaunchCmd(entry.type, workspace, null);
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
  return loadAgentsStateAt(agentsJsonPath(loaded));
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

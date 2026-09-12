import fs from "node:fs";
import path from "node:path";
import { MeshAgentsSchema, type MeshAgents } from "@seat-mesh/core";
import { buildAgentLaunchCmd } from "./agent-builder.js";

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

export function loadAgentsState(workspace: string, relPath: string): AgentsStateFile {
  const file = path.join(workspace, relPath);
  if (!fs.existsSync(file)) {
    throw new Error(`agents state not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as AgentsStateFile;
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
export function loadMeshAgents(
  workspace: string,
  relPath: string,
): MeshAgents | null {
  const file = path.join(workspace, relPath);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return MeshAgentsSchema.parse(raw);
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

  return {
    panes,
    manager,
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
export function loadLaunchState(
  workspace: string,
  meshRelPath: string,
  legacyRelPath: string,
): AgentsStateFile {
  const mesh = loadMeshAgents(workspace, meshRelPath);
  if (mesh) return meshToLegacyAgentsState(mesh);
  return loadAgentsState(workspace, legacyRelPath);
}

/**
 * Load mesh state, falling back to legacy if mesh-agents.json absent.
 * Returns a tagged result so callers know which source was used.
 */
export function loadAgentsStateCompat(
  workspace: string,
  meshRelPath: string,
  legacyRelPath: string,
): { source: "mesh"; state: MeshAgents } | { source: "legacy"; state: AgentsStateFile } {
  const mesh = loadMeshAgents(workspace, meshRelPath);
  if (mesh) return { source: "mesh", state: mesh };
  return { source: "legacy", state: loadAgentsState(workspace, legacyRelPath) };
}

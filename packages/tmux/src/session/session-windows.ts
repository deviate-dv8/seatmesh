import {
  minisLayoutEnabled,
  nvimLayoutEnabled,
  workersLayoutEnabled,
  type LoadedProfile,
} from "seat-mesh-core";
import { loadMeshAgents } from "../agents/agents-state.js";
import { tmux } from "../lib/tmux-run.js";

/** Window names present in the tmux session. */
export function listSessionWindowNames(session: string): string[] {
  const out = tmux(["list-windows", "-t", session, "-F", "#{window_name}"]).out;
  if (!out) return [];
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function sessionWindowExists(session: string, windowName: string): boolean {
  return listSessionWindowNames(session).includes(windowName);
}

/** Create a named window when missing (single starter pane). */
export function ensureSessionWindow(session: string, windowName: string, cwd: string): void {
  if (sessionWindowExists(session, windowName)) return;
  const r = tmux(["new-window", "-t", session, "-n", windowName, "-c", cwd]);
  if (!r.ok) throw new Error(`new-window ${windowName}: ${r.err || r.out}`);
}

export interface LayoutWindowFlags {
  nvim: boolean;
  workers: boolean;
  minis: boolean;
}

/** Effective window flags: mesh-agents.json layout overrides yaml. */
export function layoutWindowFlags(loaded: LoadedProfile): LayoutWindowFlags {
  const layout = loaded.profile.layout;
  if (!layout) return { nvim: false, workers: false, minis: false };
  const mesh = loadMeshAgents(loaded.workspace, loaded.profile.state.meshAgentsJson);
  const saved = mesh?.layout ?? null;
  return {
    nvim: nvimLayoutEnabled(layout, saved),
    workers: workersLayoutEnabled(layout, saved),
    minis: minisLayoutEnabled(layout, saved),
  };
}

/** Windows that should exist for borders / status (base always; others when enabled or live). */
export function activeSessionWindows(loaded: LoadedProfile, session: string): string[] {
  const layout = loaded.profile.layout;
  if (!layout) return [];
  const flags = layoutWindowFlags(loaded);
  const names = listSessionWindowNames(session);
  const out: string[] = [];
  if (flags.nvim && names.includes(layout.nvim.window)) out.push(layout.nvim.window);
  if (names.includes(layout.base.window)) out.push(layout.base.window);
  if (flags.workers && names.includes(layout.workers.window)) out.push(layout.workers.window);
  if (flags.minis && names.includes(layout.minis.window)) out.push(layout.minis.window);
  // Also include live windows when manager ran layout before save caught up
  if (!flags.workers && names.includes(layout.workers.window)) out.push(layout.workers.window);
  if (!flags.minis && names.includes(layout.minis.window)) out.push(layout.minis.window);
  return out;
}

import type { LoadedProfile } from "seat-mesh-core";
import { tmux, tmuxHasSession } from "./tmux-run.js";

/** Read MESH_WORKSPACE_ID stamped on a tmux session (session up / reload). */
export function sessionWorkspaceId(session: string): string | null {
  const r = tmux(["show-environment", "-t", session, "MESH_WORKSPACE_ID"]);
  const line = r.out.trim();
  if (!line.startsWith("MESH_WORKSPACE_ID=")) return null;
  const v = line.slice("MESH_WORKSPACE_ID=".length);
  return v || null;
}

export function listTmuxSessionNames(): string[] {
  const out = tmux(["list-sessions", "-F", "#{session_name}"]).out;
  if (!out) return [];
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** All tmux sessions tagged with this workspace hash (no cross-mesh). */
export function sessionsForWorkspace(workspaceId: string): string[] {
  return listTmuxSessionNames().filter((s) => sessionWorkspaceId(s) === workspaceId);
}

/**
 * Resolve the tmux session that actually exists for this profile/workspace.
 * Prefers scoped `mesh-<hash>`; else the single session with matching MESH_WORKSPACE_ID.
 */
export function resolveLiveTmuxSession(loaded: LoadedProfile): string {
  const scoped = loaded.sessionName;
  if (tmuxHasSession(scoped)) return scoped;

  const matches = sessionsForWorkspace(loaded.workspaceId);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const base = loaded.profile.session.name;
    return matches.find((m) => m === base) ?? matches[0]!;
  }

  const base = loaded.profile.session.name;
  if (base !== scoped && tmuxHasSession(base)) {
    const wid = sessionWorkspaceId(base);
    if (!wid || wid === loaded.workspaceId) return base;
  }

  return scoped;
}

import type { LoadedProfile } from "@seat-mesh/core/profile";
import { tmux, tmuxHasSession } from "./tmux-run.js";

function sessionEnvValue(session: string, key: string): string | null {
  const r = tmux(["show-environment", "-t", session, key]);
  const line = r.out.trim();
  const prefix = `${key}=`;
  if (!line.startsWith(prefix)) return null;
  const v = line.slice(prefix.length);
  return v || null;
}

/** Read MESH_WORKSPACE_ID stamped on a tmux session (session up / reload). */
export function sessionWorkspaceId(session: string): string | null {
  return sessionEnvValue(session, "MESH_WORKSPACE_ID");
}

export function sessionProfilePath(session: string): string | null {
  return sessionEnvValue(session, "MESH_PROFILE_PATH");
}

export function sessionWorkspacePath(session: string): string | null {
  return sessionEnvValue(session, "MESH_WORKSPACE");
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

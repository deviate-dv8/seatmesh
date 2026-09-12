import { tmux } from "../lib/tmux-run.js";

/**
 * Scrub tmux server globals that wash out TUIs (NO_COLOR, TERM=dumb).
 * Stamp mesh session identity for multi-root workspaces.
 */
export function ensureMeshSessionEnv(
  session: string,
  opts: { workspaceId?: string; sessionName?: string } = {},
): void {
  tmux(["set-environment", "-gu", "NO_COLOR"]);
  tmux(["set-environment", "-gu", "FORCE_COLOR"]);
  const gterm = tmux(["show-environment", "-g", "TERM"]).out;
  if (gterm === "TERM=dumb" || gterm === "TERM=") {
    tmux(["set-environment", "-gu", "TERM"]);
  }
  tmux(["set-environment", "-g", "COLORTERM", "truecolor"]);

  if (opts.workspaceId) {
    tmux(["set-environment", "-t", session, "MESH_WORKSPACE_ID", opts.workspaceId]);
  }
  if (opts.sessionName) {
    tmux(["set-environment", "-t", session, "MESH_SESSION", opts.sessionName]);
  }
}

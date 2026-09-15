/**
 * Session status bar chrome: folder + session so windows read as
 * `[seatmesh][mesh-c87d62] 0:nvim` — never truncated into `[mesh-c87d0:nvim`.
 */
import path from "node:path";
import { tmux } from "../lib/tmux-run.js";

export function workspaceFolderLabel(workspace: string): string {
  const base = path.basename(path.resolve(workspace)).trim();
  return base || "workspace";
}

/** Status-left text (literal — no tmux format expansion). */
export function meshStatusLeft(folder: string, sessionName: string): string {
  return `[${folder}][${sessionName}] `;
}

/**
 * Apply status-left / length so the session name is not clipped into the
 * window list (tmux default status-left-length is 10).
 */
export function applyMeshStatusChrome(
  session: string,
  opts: { workspace: string; sessionName: string },
): void {
  const folder = workspaceFolderLabel(opts.workspace);
  const left = meshStatusLeft(folder, opts.sessionName);
  // Room for folder+session brackets; window list starts after this.
  const len = Math.min(80, Math.max(32, left.length + 8));
  tmux(["set-option", "-t", session, "status", "on"]);
  tmux(["set-option", "-t", session, "status-left", left]);
  tmux(["set-option", "-t", session, "status-left-length", String(len)]);
  tmux(["set-option", "-t", session, "window-status-format", "#I:#W#{?window_flags,#{window_flags},}"]);
  tmux([
    "set-option",
    "-t",
    session,
    "window-status-current-format",
    "#I:#W#{?window_flags,#{window_flags},}",
  ]);
  tmux(["set-option", "-t", session, "window-status-separator", " "]);
}

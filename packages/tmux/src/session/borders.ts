import { tmux } from "../lib/tmux-run.js";

/**
 * Border strip (harness-shaped): ports | title | status | patience (@mesh_* vars).
 * Lead minis: @mesh_lead=1 paints ports GOLD (colour220).
 */
export const MESH_PANE_BORDER_FORMAT =
  "#[align=centre]#{?@mesh_lead,#[fg=colour220],}#{@mesh_ports}#{?@mesh_lead,#[default],}#{?@mesh_title,  |  #{@mesh_title},}#{?@mesh_status,  |  #{@mesh_status},}#{?@mesh_patience,  |  #{@mesh_patience},} ";

/** Border strip (harness-shaped; @mesh_* vars). */
export function applyMeshBorderFormat(session: string, window: string): void {
  const target = `${session}:${window}`;
  tmux(["set-window-option", "-t", target, "pane-border-status", "top"]);
  tmux(["set-window-option", "-t", target, "pane-border-format", MESH_PANE_BORDER_FORMAT]);
}

export function applyMeshSessionBorders(
  session: string,
  windows: string[],
): void {
  for (const win of windows) {
    applyMeshBorderFormat(session, win);
  }
}

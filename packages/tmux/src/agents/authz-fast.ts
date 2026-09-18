/**
 * Fast authz — one tmux @mesh_role read. No whoami / list-panes.
 * Leaf imports only (never @seat-mesh/core barrel).
 */
import type { LoadedProfile } from "@seat-mesh/core/profile";
import { isCoordKind } from "@seat-mesh/core/seat-kind";
import { tmux } from "../lib/tmux-run.js";

export function paneRoleHere(): string | null {
  const pane = process.env.TMUX_PANE;
  if (!pane) return null;
  const role = tmux(["display-message", "-t", pane, "-p", "#{@mesh_role}"]).out.trim();
  return role || null;
}

/** Coord check for spawn --fast. Missing @mesh_role → allow (operator shell). */
export function requireCoordRoleFast(loaded: LoadedProfile, cmdLabel: string): void {
  if (!process.env.TMUX_PANE) return;
  const role = paneRoleHere();
  if (!role) return;
  if (isCoordKind(role, loaded.profile?.layout?.base.kinds)) return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=manager|secretary (you_are=${role})`,
  );
  console.error("hint: seatmesh agent");
  process.exit(2);
}

/**
 * Keep checkbacks inside one mesh session.
 * Tmux pane ids (%N) are host-global and get reused across meshes — never fire
 * into a pane whose @mesh_workspace_id / session is not ours.
 */
import type { LoadedProfile } from "@seat-mesh/core";
import {
  isLabeledMeshPane,
  paneMetaForPane,
  resolvePaneTarget,
  resolveLiveTmuxSession,
} from "@seat-mesh/tmux";
import { spawnSync } from "node:child_process";
import type { CheckbackRow } from "../store/jsonl-store.js";

export interface PaneMeshIdentity {
  paneId: string;
  session: string;
  workspaceId: string;
  role: string;
  slot: string;
  mini: string;
}

function tmuxDisplay(paneId: string, fmt: string): string | null {
  if (!paneId?.startsWith("%")) return null;
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", fmt], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

/** Live tmux identity for a pane (any session). Null if pane is gone. */
export function paneMeshIdentity(paneId: string): PaneMeshIdentity | null {
  const out = tmuxDisplay(
    paneId,
    "#{pane_id}\t#{session_name}\t#{@mesh_workspace_id}\t#{@mesh_role}\t#{@mesh_slot}\t#{@mesh_mini}",
  );
  if (!out) return null;
  const [id, session, workspaceId, role, slot, mini] = out.split("\t");
  if (!id?.startsWith("%")) return null;
  return {
    paneId: id,
    session: session || "",
    workspaceId: workspaceId || "",
    role: role || "",
    slot: slot || "",
    mini: mini || "",
  };
}

export function ownerLabelFromIdentity(id: PaneMeshIdentity): string {
  if (id.mini) return `mini-${id.mini}`;
  if (id.slot && /^\d+$/.test(id.slot)) return `slot-${id.slot}`;
  if (id.slot.startsWith("mini-")) return id.slot;
  if (id.role) return id.role;
  return "";
}

/** Whether this pane currently belongs to the loaded mesh. */
export function paneBelongsToLoadedMesh(
  loaded: LoadedProfile,
  paneId: string,
): { ok: true; identity: PaneMeshIdentity } | { ok: false; reason: string; identity: PaneMeshIdentity | null } {
  const identity = paneMeshIdentity(paneId);
  if (!identity) {
    return { ok: false, reason: "pane-gone", identity: null };
  }
  const wantWs = loaded.workspaceId;
  const wantSession = resolveLiveTmuxSession(loaded);
  if (identity.workspaceId && wantWs && identity.workspaceId !== wantWs) {
    return { ok: false, reason: `foreign-workspace=${identity.workspaceId}`, identity };
  }
  if (wantSession && identity.session && identity.session !== wantSession) {
    // Allow unlabeled panes only when session matches; mismatch = foreign.
    return { ok: false, reason: `foreign-session=${identity.session}`, identity };
  }
  return { ok: true, identity };
}

/**
 * Bind CB owner pane to this mesh: keep if still ours, else retarget by label,
 * else cancel (orphan / foreign pane-id reuse).
 */
export function bindCheckbackOwnerPane(
  loaded: LoadedProfile,
  row: CheckbackRow,
): {
  paneId: string | null;
  rerouted: boolean;
  cancelReason?: string;
} {
  const pane = row.ownerPane?.trim();
  if (!pane) return { paneId: null, rerouted: false, cancelReason: "no-owner-pane" };

  const here = paneBelongsToLoadedMesh(loaded, pane);
  if (here.ok) {
    return { paneId: pane, rerouted: false };
  }

  const labels = [row.recipientLabel, row.senderLabel, row.ownerLabel]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  for (const label of labels) {
    const resolved = resolvePaneTarget(label, loaded);
    if ("error" in resolved) continue;
    const meta = paneMetaForPane(resolved.paneId);
    if (!isLabeledMeshPane(meta)) continue;
    const check = paneBelongsToLoadedMesh(loaded, resolved.paneId);
    if (!check.ok) continue;
    return {
      paneId: resolved.paneId,
      rerouted: resolved.paneId !== pane,
    };
  }

  // Pane gone inside our session — defer caller may renew; treat as cancel only when foreign.
  if (here.reason === "pane-gone") {
    return { paneId: null, rerouted: false, cancelReason: "pane-gone" };
  }
  return {
    paneId: null,
    rerouted: false,
    cancelReason: `orphan:${here.reason}`,
  };
}

/** Fields stamped when arming so later fires can retarget / scope. */
export function stampCheckbackScope(
  loaded: LoadedProfile,
  row: Partial<CheckbackRow> & { ownerPane?: string },
): Pick<CheckbackRow, "workspaceId" | "sessionName" | "ownerLabel"> {
  const sessionName = resolveLiveTmuxSession(loaded);
  const identity = row.ownerPane ? paneMeshIdentity(row.ownerPane) : null;
  const ownerLabel =
    row.ownerLabel?.trim() ||
    row.recipientLabel?.trim() ||
    (identity ? ownerLabelFromIdentity(identity) : "") ||
    undefined;
  return {
    workspaceId: loaded.workspaceId,
    sessionName,
    ownerLabel,
  };
}

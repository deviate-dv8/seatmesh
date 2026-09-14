import type { LoadedProfile } from "@seat-mesh/core";
import { isLabeledMeshPane, paneMetaForPane, resolvePaneTarget } from "@seat-mesh/tmux";
import type { PeerRow } from "../store/jsonl-store.js";

/** Re-bind queued PEER rows to live mini-N / slot-N / coord panes (layout drift). */
export function refreshPeerTargetPane(
  loaded: LoadedProfile,
  row: PeerRow,
): { paneId: string; rerouted: boolean; unresolved: boolean } {
  const label = row.targetLabel?.trim();
  if (!label) {
    const meta = paneMetaForPane(row.targetPane);
    return {
      paneId: row.targetPane,
      rerouted: false,
      unresolved: !isLabeledMeshPane(meta),
    };
  }

  const resolved = resolvePaneTarget(label, loaded);
  if ("error" in resolved) {
    return { paneId: row.targetPane, rerouted: false, unresolved: true };
  }

  const meta = paneMetaForPane(resolved.paneId);
  if (!isLabeledMeshPane(meta)) {
    return { paneId: resolved.paneId, rerouted: false, unresolved: true };
  }

  const rerouted = resolved.paneId !== row.targetPane;
  return { paneId: resolved.paneId, rerouted, unresolved: false };
}

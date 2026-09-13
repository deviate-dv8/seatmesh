import type { LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "@seat-mesh/tmux";
import type { PeerRow } from "../store/jsonl-store.js";

/** Re-bind queued PEER rows to live mini-N / slot-N / coord panes (layout drift). */
export function refreshPeerTargetPane(
  loaded: LoadedProfile,
  row: PeerRow,
): { paneId: string; rerouted: boolean } {
  const label = row.targetLabel?.trim();
  if (!label) return { paneId: row.targetPane, rerouted: false };

  const resolved = resolvePaneTarget(label, loaded);
  if ("error" in resolved) return { paneId: row.targetPane, rerouted: false };

  const rerouted = resolved.paneId !== row.targetPane;
  return { paneId: resolved.paneId, rerouted };
}

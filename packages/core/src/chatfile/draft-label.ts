import type { ComposerState, PaneSnapshot } from "../providers/types.js";

/** Label unsent composer text for chat history (Cursor follow-up, OC pending, …). */
export function resolveDraftLabel(
  providerId: string,
  state: ComposerState,
  pane: PaneSnapshot,
): "follow-up" | "pending" | "composer" {
  const tail = pane.captureTail ?? "";
  const id = providerId.trim().toLowerCase();
  if (id === "cursor-agent" || id === "agent") {
    if (state.busyLabel === "follow-up" || /Add a follow-up/i.test(tail)) {
      return "follow-up";
    }
    return "composer";
  }
  if (id === "opencode") return "pending";
  return "composer";
}

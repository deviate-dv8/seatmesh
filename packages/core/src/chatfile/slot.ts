import type { PaneSnapshot } from "../providers/types.js";
import { resolveAgentId } from "../chatroom/agent-id.js";

/** Stable slot key for CHAT.jsonl path (worker-1, mini-3, manager, ...). */
export function resolveSlotKeyFromPane(pane: PaneSnapshot): string {
  const role = pane.options.mesh_role?.trim() || "plain";
  const slotRaw = pane.options.mesh_slot;
  const slot = slotRaw ? Number.parseInt(slotRaw, 10) : null;
  const mini = pane.options.mesh_mini;
  return resolveAgentId({
    role,
    slot: Number.isFinite(slot) ? slot : null,
    mini: mini || null,
  });
}

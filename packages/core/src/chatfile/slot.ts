import type { PaneSnapshot } from "../providers/types.js";
import { resolveAgentId } from "../chatroom/agent-id.js";

/** Stable slot key for CHAT.jsonl path (worker-1, mini-3, manager, ...). */
export function resolveSlotKeyFromPane(pane: PaneSnapshot): string {
  const role = pane.options.mesh_role?.trim() || "plain";
  const slotRaw = (pane.options.mesh_slot ?? "").trim();
  const miniRaw = (pane.options.mesh_mini ?? "").trim();
  // Workers: mesh_slot is "3". Minis: mesh_slot is often "mini-6" and/or mesh_mini "6".
  let mini: string | null = miniRaw || null;
  let slot: number | null = null;
  if (/^mini-/i.test(slotRaw)) {
    mini = mini || slotRaw.replace(/^mini-/i, "");
  } else if (/^\d+$/.test(slotRaw)) {
    slot = Number.parseInt(slotRaw, 10);
  }
  return resolveAgentId({
    role,
    slot,
    mini,
  });
}

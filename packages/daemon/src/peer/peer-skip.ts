import { isSuperviseStatusBroadcast } from "@seat-mesh/core";
import type { LoadedProfile } from "@seat-mesh/core";
import { hasDeliveredColdStartPeer } from "@seat-mesh/tmux";
import type { PeerRow } from "../store/jsonl-store.js";

/** Cold-start already delivered to this pane — do not re-inject duplicate pending rows. */
export function shouldSkipDeliveredColdStart(row: PeerRow): boolean {
  if (row.fromSlot !== "mesh-cold-start") return false;
  return row.sent === true && Boolean(row.sentAt);
}

/** Duplicate FRESH SUMMON while an earlier cold-start already landed — do not wedge context. */
export function shouldSkipDuplicateColdStartResummon(
  row: PeerRow,
  loaded: LoadedProfile,
): boolean {
  if (row.fromSlot !== "mesh-cold-start" || row.sent === true) return false;
  if (!/FRESH SUMMON/.test(row.msg ?? "")) return false;
  return hasDeliveredColdStartPeer(loaded, row.targetPane);
}

/** Global room thin FYI pings must not land on worker seats (coord + @mention only). */
export function shouldSkipGlobalWorkerRoomPing(row: PeerRow): boolean {
  if (row.kind !== "room" || row.roomSlug !== "global") return false;
  if (!/^slot-[1-9]$/.test(row.targetLabel)) return false;
  return /\|\s*fyi\s+\d+\s+unseen/i.test(row.msg);
}

/** Queued rich STATUS / SUPERVISE-STATUS room pings must never land on the manager lead. */
export function shouldSkipManagerStatusRoomPing(row: PeerRow): boolean {
  if (row.kind !== "room") return false;
  if (row.targetLabel !== "manager" && row.targetLabel !== "master") return false;
  return isSuperviseStatusBroadcast(undefined, row.msg ?? "");
}

export function markPeerRowSkipped(
  store: { readPeer: () => PeerRow[]; writePeer: (rows: PeerRow[]) => void },
  row: PeerRow,
): void {
  const rows = store.readPeer();
  const i = rows.findIndex((r) => r.id === row.id);
  if (i < 0) return;
  rows[i]!.sent = true;
  rows[i]!.sentAt = new Date().toISOString();
  rows[i]!.deliverPane = "skipped";
  rows[i]!.deliverMode = "idle";
  store.writePeer(rows);
}

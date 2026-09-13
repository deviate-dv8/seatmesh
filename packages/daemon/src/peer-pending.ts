import type { PeerRow } from "./jsonl-store.js";
import { isPeerDelivered } from "./create-queue-store.js";
import type { QueueStore } from "./create-queue-store.js";

/** Parked in PEER-BACKLOG — not live inbox pressure (do not count on pane banner). */
export function isPeerParked(row: PeerRow): boolean {
  const dp = row.deliverPane;
  return dp === "backlog" || dp === "skipped";
}

/** Awaiting inject or in-flight delivery (excludes backlog/skipped). */
export function isPeerPendingDelivery(row: PeerRow): boolean {
  if (isPeerParked(row)) return false;
  return !isPeerDelivered(row);
}

export function countPeerPendingForPane(store: QueueStore, paneId: string): number {
  return store.readPeer().filter((r) => r.targetPane === paneId && isPeerPendingDelivery(r)).length;
}

export function countPeerPendingGlobal(store: QueueStore): number {
  return store.readPeer().filter((r) => isPeerPendingDelivery(r)).length;
}

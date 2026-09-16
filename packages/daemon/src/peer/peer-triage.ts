import { isTriageBodyMessage, isTriageContextPeerMsg } from "@seat-mesh/core";
import { isPeerDelivered, type PeerRow } from "../store/create-queue-store.js";

export function isTriageContextRow(row: PeerRow): boolean {
  return row.peerPhase === "triage-context" || isTriageContextPeerMsg(row.msg);
}

export function isTriageBodyRow(row: PeerRow): boolean {
  return (
    row.peerPhase === "triage-body" ||
    (row.fromAgent === "target" && isTriageBodyMessage(row.msg))
  );
}

/** Solo inject — never fold triage rows into DIGEST with unrelated mail. */
export function isTriageSoloRow(row: PeerRow): boolean {
  return isTriageContextRow(row) || isTriageBodyRow(row);
}

/** Body row waits until its linked context row is delivered (store proof, not timing). */
export function triageBodyBlockedByContext(allPeers: PeerRow[], bodyRow: PeerRow): boolean {
  const gid = bodyRow.triageGroupId?.trim();
  if (!gid) return false;
  const ctx = allPeers.find((r) => r.triageGroupId === gid && isTriageContextRow(r));
  if (!ctx) return false;
  return !isPeerDelivered(ctx);
}

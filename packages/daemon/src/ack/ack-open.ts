/**
 * Open ACK rows without pulling in the orchestrator (safe from inbox HTTP).
 */
import {
  isAckClassPeer,
  resolveAgentId,
  trimAsk,
} from "@seat-mesh/core";
import { paneMetaForPane } from "@seat-mesh/tmux";
import type { PeerRow, QueueStore, ToMasterRow } from "../store/create-queue-store.js";
import { noteDaemonInject } from "./ack-watch.js";

function seatForPane(paneId: string, labelFallback = ""): string {
  const meta = paneMetaForPane(paneId);
  if (meta?.role) {
    return resolveAgentId({
      role: meta.role,
      slot: meta.slot != null ? Number(meta.slot) : null,
      mini: meta.mini ?? null,
    });
  }
  const lab = labelFallback.trim();
  if (lab) return lab;
  return "unknown";
}

function askSnippetFromMsg(msg: string): string {
  return trimAsk(
    msg
      .replace(/\[sent:[a-z0-9]+\]/gi, "")
      .replace(/\nSHELL \(required[^\n]*/g, "")
      .replace(/\nReply: peer[^\n]*/g, "")
      .replace(/\nReply: seatmesh[^\n]*/gi, "")
      .replace(/\s+/g, " "),
  );
}

function isSubstanceAsk(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;
  // FYI / PASS / Noted / ACK received — not a new ask (n+1 if we open a row).
  if (isAckClassPeer(t)) return false;
  if (/\bintent=(supervise-tick|status|continue|checkback-verify|ack-remind|limit-retry)\b/i.test(t)) {
    return false;
  }
  if (/\[mesh-inbox\]\s+ACK\b/i.test(t)) return false;
  return true;
}

function isAckClassInboxMsg(msg: string): boolean {
  return isAckClassPeer(String(msg ?? ""));
}

/** Open ack when peer is queued or delivered (dedupe by ask text per seat). */
export function openAckForPeerRow(
  store: QueueStore,
  row: PeerRow,
  log: (line: string) => void = () => {},
): void {
  if (!isSubstanceAsk(row.msg)) return;
  const pane =
    row.deliverPane && row.deliverPane.startsWith("%") ? row.deliverPane : row.targetPane;
  if (!pane || !pane.startsWith("%")) return;
  const seat = seatForPane(pane, row.targetLabel);
  if (seat === "unknown" || seat === "plain") return;
  const from =
    row.fromAgent?.trim() ||
    (row.kind === "room" ? row.fromSlot : row.fromSlot ? `slot-${row.fromSlot}` : undefined);
  const opened = store.openAck({
    seat,
    paneId: pane,
    source: row.kind === "room" ? "room" : row.kind === "prompt" || row.kind === "remind" ? "inbox" : "peer",
    ask: askSnippetFromMsg(row.msg),
    from,
    at: row.at,
  });
  log(`ACK open id=${opened.id.slice(0, 10)} seat=${seat} source=${opened.source}`);
}

export function openAckForInboxRow(
  store: QueueStore,
  row: ToMasterRow,
  lane: "secretary" | "manager",
  paneId: string,
  log: (line: string) => void = () => {},
): void {
  if (isAckClassInboxMsg(row.msg)) return;
  if (!isSubstanceAsk(row.msg)) return;
  const seat = lane === "secretary" ? "secretary" : "manager";
  const opened = store.openAck({
    seat,
    paneId,
    source: "inbox",
    ask: askSnippetFromMsg(row.msg),
    from: row.from || row.slot || undefined,
    at: row.sentAt ?? row.at,
  });
  log(`ACK open id=${opened.id.slice(0, 10)} seat=${seat} source=inbox`);
  noteDaemonInject(paneId);
}

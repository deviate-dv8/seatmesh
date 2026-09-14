/**
 * Bulk peer/inbox digest — one inject, up to PEER_BULK_MAX items.
 * patterns.md: one paste is the expensive part; agents reply-all in one turn.
 */
import { seatmeshCmd } from "../messages/cli-hints.js";
import { MESH_INBOX_TAG } from "../messages/mesh-copy.js";
import { peerTargetFromAgentId } from "../chatroom/checkback-hint.js";
import { shortAckId } from "../ack/ack-algo.js";

/** Hard cap per pane per drain tick (operator: patterns.md expensive inject). */
export const PEER_BULK_MAX = 5;

/** Snippet length inside a DIGEST line. */
export const PEER_BULK_BODY_MAX = 220;

export interface PeerBulkItem {
  /** Sender for reply / --ended (manager, slot-2, worker-2, …). */
  from: string;
  /** Already-stamped peer body (we strip chrome for the bullet). */
  body: string;
  /** Open ACK id if known — embeds --ended shorthand. */
  ackId?: string;
}

function trimBulkBody(body: string): string {
  let t = body
    .replace(/\nSHELL \(required[^\n]*/g, "")
    .replace(/\nReply: peer[^\n]*/g, "")
    .replace(/\nFYI: follow-ups[^\n]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Drop leading mesh stamps for the bullet — DIGEST header already tags inbox.
  for (let i = 0; i < 6; i++) {
    const next = t.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (next === t) break;
    t = next;
  }
  t = t.replace(/^[^\n|]{1,40}\|\s*/, "").trim();
  return t.length > PEER_BULK_BODY_MAX ? `${t.slice(0, PEER_BULK_BODY_MAX - 1)}…` : t;
}

function endedHint(from: string, ackId?: string): string {
  if (!ackId) return "";
  const target = peerTargetFromAgentId(from);
  return ` → ${seatmeshCmd(`peer ${target} "<msg>" --ended ${shortAckId(ackId)}`)}`;
}

/**
 * One DIGEST paste for N<=PEER_BULK_MAX mail items.
 * Single-item callers should keep the original row body (no wrapper).
 */
export function formatPeerBulkDigest(opts: {
  seat: string;
  items: PeerBulkItem[];
  /** Still waiting behind this batch. */
  more?: number;
}): string {
  const items = opts.items.slice(0, PEER_BULK_MAX);
  if (!items.length) return "";
  const n = items.length;
  const lines = items.map((it, i) => {
    const from = it.from.trim() || "?";
    return `${i + 1}/${n} [${from}] ${trimBulkBody(it.body)}${endedHint(from, it.ackId)}`;
  });
  const more =
    opts.more && opts.more > 0 ? `\n(+${opts.more} more queued — next idle tick)` : "";
  return (
    `${opts.seat} | ${MESH_INBOX_TAG} DIGEST ${n} mail — answer in ONE turn; --ended closes each ACK\n` +
    lines.join("\n") +
    more
  );
}

/** Pick up to PEER_BULK_MAX rows for one pane (caller already filtered skips). */
export function takePeerBulkBatch<T>(rows: T[], max = PEER_BULK_MAX): { batch: T[]; rest: T[] } {
  const n = Math.max(1, Math.min(PEER_BULK_MAX, Math.floor(max)));
  return { batch: rows.slice(0, n), rest: rows.slice(n) };
}

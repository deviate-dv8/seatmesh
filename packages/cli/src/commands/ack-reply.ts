/**
 * Peer + close ACK in one shot (`ack reply` / `peer … --ack`).
 * Limits n+1: answer and clear without a second prompt.
 */
import {
  type AckRow,
  type LoadedProfile,
  chatRoomConfigForLoaded,
  clearAckEndedSync,
  isAckClassPeer,
  openAcks,
  peerTargetFromAgentId,
  shortAckId,
} from "@seat-mesh/core";
import { runPeer, runWhoami } from "@seat-mesh/tmux";

export const ACK_REPLY_DEFAULT_MSG = "ACK";

/** Normalize seat tokens for from↔target match. */
export function normalizeSeatToken(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/^slot-/, "");
  if (/^worker-(\d+)$/.test(t)) return t.replace(/^worker-/, "");
  if (t === "master") return "manager";
  return t;
}

export function fromMatchesPeerTarget(from: string | undefined, target: string): boolean {
  if (!from?.trim()) return false;
  const a = normalizeSeatToken(peerTargetFromAgentId(from));
  const b = normalizeSeatToken(target);
  if (a === b) return true;
  // mini-1 vs manager-mini-1
  if (a.replace(/^manager-/, "") === b.replace(/^manager-/, "")) return true;
  return false;
}

/** Pick open ACK to close when peening `target` (prefer matching `from`). */
export function pickAckForPeerTarget(rows: AckRow[], target: string): AckRow | undefined {
  const open = openAcks(rows);
  if (!open.length) return undefined;
  const matched = open.filter((r) => fromMatchesPeerTarget(r.from, target));
  if (matched.length) {
    matched.sort((a, b) => a.at.localeCompare(b.at));
    return matched[0];
  }
  if (open.length === 1) return open[0];
  return undefined;
}

export async function fetchAckEntries(
  loaded: LoadedProfile,
  opts: { all?: boolean; seat?: string } = {},
): Promise<AckRow[]> {
  const base = chatRoomConfigForLoaded(loaded).inboxBase.replace(/\/$/, "");
  const q = new URLSearchParams();
  if (opts.all) q.set("all", "1");
  if (opts.seat) q.set("seat", opts.seat);
  const res = await fetch(`${base}/ack?${q}`);
  const data = (await res.json()) as { entries?: AckRow[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.entries ?? [];
}

/** Resolve --ack / --ended id, or auto-pick for this peer target. */
export async function resolvePeerEndedAckId(
  loaded: LoadedProfile,
  target: string,
  endedId: string | undefined,
): Promise<string | undefined> {
  if (endedId && endedId !== "__auto__") return endedId;
  if (!endedId) return undefined;
  const w = runWhoami(loaded, "here");
  const rows = openAcks(await fetchAckEntries(loaded));
  const mine = rows.filter((r) => {
    if (w.paneId && r.paneId === w.paneId) return true;
    const seat = normalizeSeatToken(r.seat);
    const role = normalizeSeatToken(w.role || "");
    const label = normalizeSeatToken(w.slotLabel || "");
    return seat === role || seat === label || (label && seat === label.replace(/^slot-/, ""));
  });
  const hit = pickAckForPeerTarget(mine.length ? mine : rows, target);
  return hit?.id;
}

/**
 * When the peer body is itself an ACK/FYI closing, auto-attach --ack so the
 * open ask clears without a second command.
 */
export function shouldAutoAckReply(msg: string, endedId: string | undefined): boolean {
  if (endedId) return false;
  return isAckClassPeer(msg);
}

/** `ack reply <id> [msg]` → peer back to asker + close. */
export async function runAckReply(
  loaded: LoadedProfile,
  id: string,
  msgRaw?: string,
): Promise<{ target: string; ackId: string; msg: string }> {
  const needle = id.trim().toLowerCase().replace(/^ack-/, "");
  const rows = await fetchAckEntries(loaded, { all: true });
  const row = rows.find(
    (r) =>
      r.id.toLowerCase() === `ack-${needle}` ||
      r.id.toLowerCase().startsWith(`ack-${needle}`) ||
      r.id.replace(/^ack-/, "").startsWith(needle) ||
      shortAckId(r.id) === needle,
  );
  if (!row) throw new Error(`ack not found: ${id}`);
  if (row.ackedAt) throw new Error(`ack already closed: ${shortAckId(row.id)}`);
  const from = row.from?.trim();
  if (!from) {
    throw new Error(
      `ack ${shortAckId(row.id)} has no from (operator ask) — use: seatmesh agent ack ${shortAckId(row.id)}`,
    );
  }
  const target = peerTargetFromAgentId(from);
  const msg = (msgRaw ?? "").trim() || ACK_REPLY_DEFAULT_MSG;
  runPeer(loaded, target, msg);
  const cfg = chatRoomConfigForLoaded(loaded);
  const res = clearAckEndedSync(cfg.inboxBase, row.id, `ack reply -> ${target}: ${msg}`);
  if (!res.ok) {
    throw new Error(`peer sent but ack close failed: ${res.error ?? "?"}`);
  }
  return { target, ackId: res.id ?? row.id, msg };
}

/** ACK inject + banner copy. Consts live here; never paste ad-hoc wording into a pane. */
import { seatmeshCmd } from "../messages/cli-hints.js";
import { MESH_INBOX_TAG } from "../messages/mesh-copy.js";
import { peerTargetFromAgentId } from "../chatroom/checkback-hint.js";
import {
  ACK_REMIND_LIST_MAX,
  isAckStale,
  openAcks,
  shortAckId,
} from "./ack-algo.js";
import type { AckRow } from "./types.js";

export const ACK_TAG = "ACK";

/** Explicit clear when there is no peer reply to send. */
export function formatAckClearCmd(id: string): string {
  return seatmeshCmd(`ack ${shortAckId(id)} "<one line>"`);
}

/**
 * One shell line that both replies and closes the ACK (stops the n+3 loop:
 * peer → ack → maybe cb cancel).
 */
export function formatPeerEndedCmd(to: string, id: string): string {
  const target = peerTargetFromAgentId(to);
  return seatmeshCmd(`peer ${target} "<msg>" --ended ${shortAckId(id)}`);
}

export function formatAckListCmd(): string {
  return seatmeshCmd("ack");
}

function askSnippet(ask: string, max = 72): string {
  const t = ask.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One row as a reminder bullet: `· a7f3k2 operator: fix the banner overflow`. */
export function formatAckOpenLine(row: AckRow): string {
  const who = row.source === "operator" ? "operator" : row.from?.trim() || row.source;
  return `· ${shortAckId(row.id)} ${who}: ${askSnippet(row.ask)}`;
}

/** Preferred clear shell for one open row. */
export function formatAckCloseShell(row: AckRow): string {
  if (row.source === "operator" || !row.from?.trim()) {
    return formatAckClearCmd(row.id);
  }
  return formatPeerEndedCmd(row.from, row.id);
}

/**
 * Reminder inject for a seat with open rows.
 *
 * Lists the asks (an agent cannot answer a bare count) and ends on the shell
 * line, because a chat-only "acknowledged" is exactly the failure being caught.
 */
export function formatAckReminder(seat: string, rows: AckRow[]): string {
  const open = openAcks(rows);
  if (!open.length) return "";
  const shown = open.slice(0, ACK_REMIND_LIST_MAX);
  const more = open.length - shown.length;
  const head = `${seat} | ${MESH_INBOX_TAG} ${ACK_TAG} ${open.length} unanswered — answer + --ended closes it`;
  const body = shown.map(formatAckOpenLine).join("\n");
  const first = shown[0]!;
  const tail = more > 0 ? `\n· +${more} more — ${formatAckListCmd()}` : "";
  return (
    `${head}\n${body}${tail}\n` +
    `SHELL (required — chat reply does NOT clear): ${formatAckCloseShell(first)}\n` +
    `FYI: follow-ups / more inbox while busy are queued — they inject when idle.`
  );
}

/** Banner segment. `ack 2` open, `ack 2!` when a row gave up on reminders. */
export function formatBannerAck(open: number, stale = 0): string {
  const n = Math.max(0, open);
  return stale > 0 ? `ack ${n}!` : `ack ${n}`;
}

export function compactBannerAck(full: string): string {
  const m = full.match(/^ack (\d+)(!?)$/);
  return m ? `a${m[1]}${m[2]}` : full;
}

/** `ack list` row for the operator. */
export function formatAckStatusLine(row: AckRow): string {
  const state = row.ackedAt
    ? `acked:${row.ackBy ?? "?"}`
    : isAckStale(row)
      ? "STALE"
      : `open r${row.reminders}`;
  const who = row.source === "operator" ? "operator" : row.from?.trim() || row.source;
  return [
    shortAckId(row.id),
    row.seat,
    state,
    who,
    askSnippet(row.ask, 60),
    row.ackNote ? `(${askSnippet(row.ackNote, 40)})` : "",
  ]
    .filter(Boolean)
    .join("\t");
}

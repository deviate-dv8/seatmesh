/**
 * ACK ledger algorithm (pure).
 *
 * Recurring failure this exists to catch: a seat is given an ask — the operator
 * types it into the pane, or mesh mail lands in it — and the agent answers in
 * chat prose without ever filing, or silently drops it. Nothing in the mesh
 * remembers the ask, so the operator has no list of what is still unanswered.
 *
 * Every ask opens a row. A row clears on evidence (explicit ack, or an outbound
 * filing from that seat afterwards). While rows stay open the daemon re-injects a
 * reminder on a doubling backoff, then gives up nagging and leaves them visible.
 */
import { isSmInjectText } from "../messages/mesh-inject-text.js";
import type { AckRow } from "./types.js";

/** Ask text stored per row — enough to recognise, short enough to inject. */
export const ACK_ASK_MAX = 200;

/** Reminder injects per row before it stops nagging (stale, report-only). */
export const ACK_REMIND_MAX = 4;
/** First reminder delay after a row opens; doubles per fire up to the cap. */
export const ACK_REMIND_FIRST_SEC = 90;
export const ACK_REMIND_CAP_SEC = 600;

/** Open rows listed in one reminder inject — keeps the paste one screen. */
export const ACK_REMIND_LIST_MAX = 3;

export function shortAckId(id: string): string {
  return id.replace(/^ack-/, "").slice(0, 6);
}

export function trimAsk(ask: string): string {
  const t = ask.replace(/\s+/g, " ").trim();
  return t.length > ACK_ASK_MAX ? `${t.slice(0, ACK_ASK_MAX - 1)}…` : t;
}

export function isAckOpen(row: AckRow): boolean {
  return !row.ackedAt;
}

/** Out of reminders — the agent stopped answering, so surface it to the operator instead. */
export function isAckStale(row: AckRow): boolean {
  return isAckOpen(row) && row.reminders >= ACK_REMIND_MAX;
}

export function openAcks(rows: AckRow[]): AckRow[] {
  return rows.filter(isAckOpen);
}

export function openAcksForSeat(rows: AckRow[], seat: string): AckRow[] {
  const want = seat.trim().toLowerCase();
  return openAcks(rows)
    .filter((r) => r.seat.trim().toLowerCase() === want)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Doubling backoff so a stuck seat is nudged soon, then rarely. */
export function ackRemindDelaySec(reminders: number): number {
  const n = Math.max(0, Math.floor(reminders));
  return Math.min(ACK_REMIND_FIRST_SEC * 2 ** n, ACK_REMIND_CAP_SEC);
}

/** Rows worth injecting a reminder for (stale ones are report-only). */
export function remindableAcks(rows: AckRow[]): AckRow[] {
  return openAcks(rows).filter((r) => r.reminders < ACK_REMIND_MAX);
}

// ---------------------------------------------------------------------------
// Operator prompt detection
// ---------------------------------------------------------------------------

export interface PromptObservation {
  /** Live composer draft this tick ("" when the composer is empty). */
  draft: string;
  /** Full pane capture tail — holds the transcript echo after a submit. */
  captureTail: string;
}

export interface PromptWatchState {
  /** Last human draft seen that has not yet been submitted or abandoned. */
  pendingDraft: string;
  pendingAt: number;
}

export type PromptWatchEvent =
  | { kind: "none" }
  | { kind: "typing" }
  | { kind: "submitted"; prompt: string }
  | { kind: "abandoned" };

export const EMPTY_PROMPT_WATCH: PromptWatchState = { pendingDraft: "", pendingAt: 0 };

export function normalizePromptText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Transcript gutter Claude/Cursor/OpenCode draw in front of an echoed user turn. */
const PROMPT_GUTTER_RE = /^[\s>❯⏺·•│┃|*+-]+/;

/** Shortest draft prefix trusted as an echo match — below this, false positives. */
const ECHO_MIN_PREFIX = 4;
const ECHO_PREFIX_LEN = 40;

/**
 * Find the submitted prompt echoed in the transcript.
 *
 * Called only when the composer just went empty, so the draft text cannot still
 * be in the composer — if it is anywhere on screen the CLI committed it to the
 * transcript, which means the operator pressed Enter rather than clearing.
 */
export function extractSubmittedPrompt(captureTail: string, draft: string): string {
  const want = normalizePromptText(draft);
  if (want.length < ECHO_MIN_PREFIX) return "";
  const prefix = want.slice(0, ECHO_PREFIX_LEN);

  for (const line of captureTail.split("\n")) {
    const body = line.replace(PROMPT_GUTTER_RE, "").trim();
    if (!body) continue;
    if (!normalizePromptText(body).includes(prefix)) continue;
    // A wrapped prompt echoes across rows, so the matched row can be shorter
    // than what we last saw being typed. Keep whichever is more complete.
    return body.length >= draft.trim().length ? body : draft.trim();
  }
  return "";
}

/**
 * Per-pane composer transition: draft seen, then draft gone.
 *
 * Gone + echoed in the transcript = the operator submitted it (an ask that owes
 * an answer). Gone + not echoed = cleared or backspaced away, so nothing is owed.
 * Mesh copy is never an operator ask — the mail path opens those rows itself.
 */
export function classifyPromptTick(
  prev: PromptWatchState | undefined,
  obs: PromptObservation,
  nowMs: number,
): { next: PromptWatchState; event: PromptWatchEvent } {
  const draft = obs.draft.trim();

  if (draft) {
    if (isSmInjectText(draft)) {
      return { next: EMPTY_PROMPT_WATCH, event: { kind: "none" } };
    }
    return {
      next: { pendingDraft: draft, pendingAt: prev?.pendingAt || nowMs },
      event: { kind: "typing" },
    };
  }

  const pending = prev?.pendingDraft?.trim() ?? "";
  if (!pending) return { next: EMPTY_PROMPT_WATCH, event: { kind: "none" } };

  const prompt = extractSubmittedPrompt(obs.captureTail, pending);
  if (prompt) {
    return { next: EMPTY_PROMPT_WATCH, event: { kind: "submitted", prompt } };
  }
  return { next: EMPTY_PROMPT_WATCH, event: { kind: "abandoned" } };
}

// ---------------------------------------------------------------------------
// Close on filing evidence
// ---------------------------------------------------------------------------

/** An outbound the seat filed through the mesh (peer / inbox / room). */
export interface SeatFiling {
  seat: string;
  at: string;
  /** Short audit note, e.g. "peer -> manager". */
  what: string;
}

/**
 * Pair open rows with filings that came after them.
 *
 * The mesh contract is "answer by filing", so an outbound from a seat is the
 * evidence that the seat acted. Oldest open row pairs with the earliest later
 * filing, one filing per row, so a burst of replies cannot clear a whole backlog.
 */
export function matchFiledAcks(
  rows: AckRow[],
  filings: SeatFiling[],
): { row: AckRow; note: string }[] {
  const bySeat = new Map<string, AckRow[]>();
  for (const row of openAcks(rows)) {
    const key = row.seat.trim().toLowerCase();
    const list = bySeat.get(key) ?? [];
    list.push(row);
    bySeat.set(key, list);
  }
  for (const list of bySeat.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  const matched: { row: AckRow; note: string }[] = [];
  const sorted = [...filings].sort((a, b) => a.at.localeCompare(b.at));
  for (const filing of sorted) {
    const list = bySeat.get(filing.seat.trim().toLowerCase());
    if (!list?.length) continue;
    const idx = list.findIndex((r) => r.at < filing.at);
    if (idx < 0) continue;
    const [row] = list.splice(idx, 1);
    matched.push({ row: row!, note: filing.what });
  }
  return matched;
}

/** Apply a close in place — `ackedAt` set is the only thing that ends a row. */
export function closeAckRow(
  row: AckRow,
  by: AckRow["ackBy"],
  note?: string,
  nowIso = new Date().toISOString(),
): AckRow {
  row.ackedAt = nowIso;
  row.ackBy = by;
  const n = note?.replace(/\s+/g, " ").trim();
  if (n) row.ackNote = n.length > ACK_ASK_MAX ? `${n.slice(0, ACK_ASK_MAX - 1)}…` : n;
  return row;
}

/** Where the unanswered ask came from. */
export type AckSource = "operator" | "inbox" | "peer" | "room";

/** How an open row was cleared (audit only — `ackedAt` is the state). */
export type AckCloseBy = "explicit" | "filed" | "operator";

/**
 * One unanswered ask against one seat, in ACK.jsonl.
 *
 * `ackedAt` is the whole state: empty means open, set means cleared. Every other
 * field is provenance for the operator reading `ack list`.
 */
export interface AckRow {
  id: string;
  /** Opened at (ISO). */
  at: string;
  /** Agent id of the seat that owes the answer (manager, secretary, worker-1). */
  seat: string;
  paneId: string;
  source: AckSource;
  /** Sender agent id for mesh mail; unset for operator prompts. */
  from?: string;
  /** The ask, trimmed to ACK_ASK_MAX. */
  ask: string;
  /** The one state field — empty = open. */
  ackedAt?: string;
  ackBy?: AckCloseBy;
  ackNote?: string;
  /** Reminder injects fired so far. */
  reminders: number;
  remindedAt?: string;
}

export interface AckOpenInput {
  seat: string;
  paneId: string;
  source: AckSource;
  ask: string;
  from?: string;
  id?: string;
  at?: string;
}

import type { QueueStore } from "./create-queue-store.js";
import { countPeerPendingForPane } from "./peer-pending.js";

/** Pending inject pressure (peer queue + armed checkbacks on this pane). */
export const INBOX_OVERLOAD_THRESHOLD = 25;

export const INBOX_OVERLOAD_COOLDOWN_MS = 10 * 60 * 1000;

const paneCooldownUntil = new Map<string, number>();

export function resetInboxOverloadStateForTests(): void {
  paneCooldownUntil.clear();
}

export function countInboxTriggersForPane(store: QueueStore, paneId: string): number {
  // Checkbacks are scheduled polls — counting them caused overload self-lock (cb wedge).
  return countPeerPendingForPane(store, paneId);
}

export function overloadCooldownRemainingMs(paneId: string, nowMs = Date.now()): number {
  const until = paneCooldownUntil.get(paneId) ?? 0;
  return Math.max(0, until - nowMs);
}

export function overloadWarnMessage(count: number): string {
  const mins = Math.round(INBOX_OVERLOAD_COOLDOWN_MS / 60_000);
  return (
    `[mesh-inbox] OVERLOAD: ${count} pending inbox triggers on this pane — ` +
    `you may be overloaded or spammed. Daemon pauses injects here for ${mins} minutes.`
  );
}

export interface InboxOverloadEval {
  hold: boolean;
  reason?: string;
  count: number;
  /** Deliver once when entering cooldown (use force inject). */
  warn?: boolean;
  warnMessage?: string;
}

/** Rising edge at >= threshold starts 10m cooldown; all injects held until it expires. */
export function evaluateInboxOverload(
  store: QueueStore,
  paneId: string,
  nowMs = Date.now(),
): InboxOverloadEval {
  const count = countInboxTriggersForPane(store, paneId);
  const remaining = overloadCooldownRemainingMs(paneId, nowMs);
  if (remaining > 0) {
    return {
      hold: true,
      reason: `held:overload-cooldown:${Math.ceil(remaining / 1000)}s`,
      count,
    };
  }

  if (count >= INBOX_OVERLOAD_THRESHOLD) {
    paneCooldownUntil.set(paneId, nowMs + INBOX_OVERLOAD_COOLDOWN_MS);
    return {
      hold: true,
      reason: "held:overload-cooldown",
      count,
      warn: true,
      warnMessage: overloadWarnMessage(count),
    };
  }

  return { hold: false, count };
}

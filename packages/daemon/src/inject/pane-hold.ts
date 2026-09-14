/**
 * When a pane is typing/busy, stop hammering capture/deliver every poll tick.
 * That spam was making the composer feel laggy (tmux capture + draft restore churn).
 */
const HOLD_MS = Number(process.env.MESH_INBOX_PANE_HOLD_MS ?? 12_000);

const holdUntilByPane = new Map<string, number>();

const HOLD_RE =
  /typing|busy|wait-typing|wait-busy|cotyped|wait-settle|plain_shell|plain_pane/i;

export function notePaneDeliveryHold(paneId: string, reason: string, nowMs = Date.now()): void {
  if (!paneId.startsWith("%")) return;
  if (!HOLD_RE.test(reason)) return;
  const prev = holdUntilByPane.get(paneId) ?? 0;
  const next = nowMs + HOLD_MS;
  if (next > prev) holdUntilByPane.set(paneId, next);
}

export function paneInDeliveryHold(paneId: string, nowMs = Date.now()): boolean {
  const until = holdUntilByPane.get(paneId) ?? 0;
  if (until <= nowMs) {
    if (until) holdUntilByPane.delete(paneId);
    return false;
  }
  return true;
}

export function resetPaneDeliveryHolds(): void {
  holdUntilByPane.clear();
}

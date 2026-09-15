/**
 * Operator-prompt watch.
 *
 * Border paint already captures every pane each tick, so it feeds composer state
 * in here instead of us capturing a second time. This module holds only in-memory
 * transition state; `ack-sweep` drains detected submits and writes the ledger.
 */
import {
  classifyPromptTick,
  EMPTY_PROMPT_WATCH,
  type PromptWatchState,
} from "@seat-mesh/core";

export interface OperatorPrompt {
  paneId: string;
  label: string;
  prompt: string;
  at: string;
}

/**
 * A daemon paste clears and refills the composer itself (copy → clear → paste →
 * submit → restore). Ignore submit detection for this long afterwards so our own
 * write is never filed as an operator ask.
 */
const DAEMON_INJECT_QUIET_MS = 5_000;

const watchByPane = new Map<string, PromptWatchState>();
const injectedAtByPane = new Map<string, number>();
let pending: OperatorPrompt[] = [];

/** After an operator submit: wait for busy, then idle → in-pane reply closed the ask. */
interface OperatorReplyArm {
  armed: boolean;
  sawBusy: boolean;
}
const replyArmByPane = new Map<string, OperatorReplyArm>();
let pendingPaneReplyClose: string[] = [];

export function noteDaemonInject(paneId: string, nowMs = Date.now()): void {
  injectedAtByPane.set(paneId, nowMs);
  watchByPane.delete(paneId);
  // Daemon paste is not an in-pane agent answer to an operator ask.
  replyArmByPane.delete(paneId);
}

/** Feed one tick of composer state for a labeled mesh pane. */
export function observePaneComposer(
  paneId: string,
  label: string,
  draft: string,
  captureTail: string,
  phase = "",
  nowMs = Date.now(),
): void {
  const injectedAt = injectedAtByPane.get(paneId) ?? 0;
  if (injectedAt && nowMs - injectedAt < DAEMON_INJECT_QUIET_MS) {
    watchByPane.set(paneId, EMPTY_PROMPT_WATCH);
    return;
  }

  const { next, event } = classifyPromptTick(
    watchByPane.get(paneId),
    { draft, captureTail },
    nowMs,
  );
  watchByPane.set(paneId, next);
  if (event.kind === "submitted") {
    pending.push({ paneId, label, prompt: event.prompt, at: new Date(nowMs).toISOString() });
    // Arm: next busy→idle cycle means the agent answered in the pane.
    replyArmByPane.set(paneId, { armed: true, sawBusy: false });
  }

  trackOperatorReplyCycle(paneId, phase);
}

function trackOperatorReplyCycle(paneId: string, phase: string): void {
  const arm = replyArmByPane.get(paneId);
  if (!arm?.armed) return;
  if (phase === "busy") {
    arm.sawBusy = true;
    replyArmByPane.set(paneId, arm);
    return;
  }
  if (arm.sawBusy && (phase === "empty" || phase === "afk")) {
    pendingPaneReplyClose.push(paneId);
    replyArmByPane.delete(paneId);
  }
}

/** Take everything detected since the last drain. */
export function drainOperatorPrompts(): OperatorPrompt[] {
  const out = pending;
  pending = [];
  return out;
}

/** Panes whose agent finished an in-pane reply after an operator submit. */
export function drainOperatorPaneReplyCloses(): string[] {
  const out = [...new Set(pendingPaneReplyClose)];
  pendingPaneReplyClose = [];
  return out;
}

export function resetAckWatch(): void {
  watchByPane.clear();
  injectedAtByPane.clear();
  replyArmByPane.clear();
  pending = [];
  pendingPaneReplyClose = [];
}

import type { ProviderRegistry } from "@seat-mesh/core";
import { capturePaneSnapshot } from "@seat-mesh/tmux";
import { notifyConnectivityStatus, RESUME_ACK_HOWTO } from "./oc-resume.js";

/** How long to wait for a resumed pane to prove it's working again before flagging it stuck. */
const ACK_TIMEOUT_MS = 5 * 60_000;

export interface ResumeAckWave {
  paneIds: Set<string>;
  acked: Set<string>;
  reason: string;
  startedAt: number;
  timeoutNotified: boolean;
}

/** Module-level: at most one resume wave is tracked for ack at a time (a new wave replaces it). */
let activeWave: ResumeAckWave | null = null;

export function currentResumeAckWave(): ResumeAckWave | null {
  return activeWave;
}

/** Test-only: reset module state between cases. */
export function resetResumeAckWave(): void {
  activeWave = null;
}

/**
 * Pure decision: given a wave's ack progress, what should the daemon do next?
 * Exported for unit testing without tmux/process spawning.
 */
export function nextAckWaveAction(
  input: { total: number; ackedCount: number; startedAt: number; timeoutNotified: boolean },
  nowMs: number = Date.now(),
  timeoutMs: number = ACK_TIMEOUT_MS,
): "idle" | "all-acked" | "timeout" | "waiting" {
  if (input.total <= 0) return "idle";
  if (input.ackedCount >= input.total) return "all-acked";
  if (!input.timeoutNotified && nowMs - input.startedAt >= timeoutMs) return "timeout";
  return "waiting";
}

/**
 * Call right after a resume wave is sent — arms ack tracking for exactly those panes.
 * A fresh wave replaces whatever was pending (the newest resume is the one that matters).
 */
export function armResumeAckWave(paneIds: string[], reason: string): void {
  if (!paneIds.length) return;
  activeWave = {
    paneIds: new Set(paneIds),
    acked: new Set(),
    reason,
    startedAt: Date.now(),
    timeoutNotified: false,
  };
}

/**
 * Poll tick: check pending panes for proof they're actually working again (composer no
 * longer shows `limit`), then notify operator once the wave fully confirms or times out.
 */
export function pollResumeAcks(
  registry: ProviderRegistry,
  workspace: string,
  log: (line: string) => void,
  onPaneAcked?: (paneId: string) => void,
): void {
  const wave = activeWave;
  if (!wave) return;

  for (const paneId of wave.paneIds) {
    if (wave.acked.has(paneId)) continue;
    const snap = capturePaneSnapshot(paneId);
    if (!snap) {
      wave.acked.add(paneId);
      continue;
    }
    const prov = registry.detect(snap);
    if (prov?.id !== "opencode") {
      wave.acked.add(paneId);
      continue;
    }
    if (prov.composerState(snap).phase !== "limit") {
      wave.acked.add(paneId);
      log(`OC-RESUME ack ${paneId} confirmed working — clearing OC-LIMIT banner`);
      onPaneAcked?.(paneId);
    }
  }

  const action = nextAckWaveAction({
    total: wave.paneIds.size,
    ackedCount: wave.acked.size,
    startedAt: wave.startedAt,
    timeoutNotified: wave.timeoutNotified,
  });

  if (action === "all-acked") {
    log(`OC-RESUME all acked (${wave.acked.size}/${wave.paneIds.size}) reason=${wave.reason}`);
    notifyConnectivityStatus(
      workspace,
      "OC resume",
      `All ${wave.paneIds.size} resumed OC panes acked — limit screens cleared (${wave.reason}).`,
      "No action needed.",
      "complete",
    );
    activeWave = null;
    return;
  }

  if (action === "timeout") {
    wave.timeoutNotified = true;
    const stuck = wave.paneIds.size - wave.acked.size;
    const ageSec = Math.round((Date.now() - wave.startedAt) / 1000);
    log(`OC-RESUME ack timeout: ${stuck}/${wave.paneIds.size} unconfirmed after ${ageSec}s`);
    notifyConnectivityStatus(
      workspace,
      "OC resume",
      `${stuck}/${wave.paneIds.size} resumed panes still not acked after ${ageSec}s (${wave.reason}).`,
      `${RESUME_ACK_HOWTO} Stuck panes: open pane, confirm limit text gone or press Enter once on resume.`,
      "incomplete",
    );
  }
}

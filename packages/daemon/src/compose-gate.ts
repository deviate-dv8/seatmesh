import type { ComposerState } from "@seat-mesh/core";
import { coordComposerDraft } from "@seat-mesh/providers";

/** Post-generate / empty-composer settle (manager + secretary only). */
export const COORD_IDLE_SETTLE_MS = Number(process.env.MESH_INBOX_IDLE_SETTLE_MS ?? 5000);

export type CoordGatePhase =
  | "idle"
  | "wait-busy"
  | "wait-typing"
  | "wait-settle"
  | "wait-not-ready"
  | "plain_shell";

export interface CoordGateResult {
  phase: CoordGatePhase;
  canDeliver: boolean;
  settleInSec?: number;
  draftFp?: string;
}

interface PaneGateState {
  wasBusy: boolean;
  lastBusyEndedAt: number;
  idleReadySince: number;
}

const gateByPane = new Map<string, PaneGateState>();

function gateState(paneId: string): PaneGateState {
  let s = gateByPane.get(paneId);
  if (!s) {
    s = { wasBusy: false, lastBusyEndedAt: 0, idleReadySince: 0 };
    gateByPane.set(paneId, s);
  }
  return s;
}

/** Reset gate clocks (tests). */
export function resetCoordGateState(paneId?: string): void {
  if (paneId) gateByPane.delete(paneId);
  else gateByPane.clear();
}

function composerIdleReady(state: ComposerState, captureTail: string, providerId: string): boolean {
  if (state.phase === "plain_shell" || state.phase === "limit") return false;
  if (state.phase === "busy" || state.phase === "typing") return false;
  const draft =
    state.draftFingerprint?.trim() || coordComposerDraft(captureTail, providerId);
  if (draft) return false;
  return state.phase === "empty" || state.phase === "afk";
}

/**
 * Manager/secretary inject gate: never paste while generating or typing;
 * after generate ends, wait full COORD_IDLE_SETTLE_MS before idle inject.
 */
export function classifyCoordDelivery(
  paneId: string,
  state: ComposerState,
  captureTail: string,
  providerId: string,
  nowMs = Date.now(),
): CoordGateResult {
  const st = gateState(paneId);

  if (state.phase === "plain_shell") {
    return { phase: "plain_shell", canDeliver: false };
  }
  if (state.phase === "limit") {
    return { phase: "wait-not-ready", canDeliver: false };
  }

  if (state.phase === "busy") {
    st.wasBusy = true;
    st.idleReadySince = 0;
    return { phase: "wait-busy", canDeliver: false };
  }

  if (st.wasBusy) {
    st.wasBusy = false;
    st.lastBusyEndedAt = nowMs;
    st.idleReadySince = 0;
  }

  const draftFp =
    state.draftFingerprint?.trim() ||
    coordComposerDraft(captureTail, providerId) ||
    undefined;
  if (state.phase === "typing" || draftFp) {
    st.idleReadySince = 0;
    return { phase: "wait-typing", canDeliver: false, draftFp };
  }

  if (!composerIdleReady(state, captureTail, providerId)) {
    st.idleReadySince = 0;
    return { phase: "wait-not-ready", canDeliver: false };
  }

  if (!st.idleReadySince) st.idleReadySince = nowMs;

  const settleSec = COORD_IDLE_SETTLE_MS / 1000;
  const emptySettled = (nowMs - st.idleReadySince) / 1000;
  const busySettled = st.lastBusyEndedAt
    ? (nowMs - st.lastBusyEndedAt) / 1000
    : settleSec;
  const settled = Math.min(emptySettled, busySettled);

  if (settled < settleSec) {
    return {
      phase: "wait-settle",
      canDeliver: false,
      settleInSec: Math.max(0, Math.ceil(settleSec - settled)),
    };
  }

  return { phase: "idle", canDeliver: true };
}

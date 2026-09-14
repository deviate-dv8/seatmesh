import type { ComposerState } from "@seat-mesh/core";
import { coordComposerDraft } from "@seat-mesh/providers";

/** Post-generate / empty-composer settle (manager + secretary only). */
export const COORD_IDLE_SETTLE_MS = Number(process.env.MESH_INBOX_IDLE_SETTLE_MS ?? 1500);

/**
 * Stable draft age before AFK deliver+restore (inject saves/restores human text).
 * Matches zsign legacy INBOX_STUCK_SEC intent — do not wipe; paste DIGEST around it.
 */
export const COORD_STUCK_DRAFT_SEC = Number(process.env.MESH_INBOX_STUCK_SEC ?? 45);

let profileSkipTypingGate = false;

/** TEMP bypass: profile daemon.skipTypingGate or MESH_INBOX_SKIP_TYPING_GATE=1 */
export function configureInboxTypingGate(opts: { skip?: boolean }): void {
  profileSkipTypingGate = opts.skip === true;
}

export function inboxSkipTypingGate(): boolean {
  if (profileSkipTypingGate) return true;
  const v = process.env.MESH_INBOX_SKIP_TYPING_GATE;
  return v === "1" || v === "true";
}

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
  clearInSec?: number;
  draftFp?: string;
}

interface PaneGateState {
  wasBusy: boolean;
  lastBusyEndedAt: number;
  idleReadySince: number;
  draftFp: string;
  draftSince: number;
}

const gateByPane = new Map<string, PaneGateState>();

function gateState(paneId: string): PaneGateState {
  let s = gateByPane.get(paneId);
  if (!s) {
    s = {
      wasBusy: false,
      lastBusyEndedAt: 0,
      idleReadySince: 0,
      draftFp: "",
      draftSince: 0,
    };
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
    state.draftFingerprint?.trim() ||
    coordComposerDraft(stripMeshForDraft(captureTail), providerId);
  if (draft) return false;
  return state.phase === "empty" || state.phase === "afk";
}

/** Drop mesh-owned chrome before draft sniff (checkback box uses → [mesh-inbox]). */
function stripMeshForDraft(captureTail: string): string {
  return captureTail
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/\[mesh-inbox/i.test(t)) return false;
      if (/^intent=/i.test(t)) return false;
      if (/^Check:/i.test(t)) return false;
      if (/\bOC-LIMIT:/i.test(t)) return false;
      return true;
    })
    .join("\n");
}

function trackDraftAge(st: PaneGateState, draftFp: string | undefined, nowMs: number): number {
  const fp = draftFp?.trim() ?? "";
  if (!fp) {
    st.draftFp = "";
    st.draftSince = 0;
    return 0;
  }
  if (fp !== st.draftFp) {
    st.draftFp = fp;
    st.draftSince = nowMs;
  }
  return st.draftSince ? (nowMs - st.draftSince) / 1000 : 0;
}

/**
 * Manager/secretary inject gate: never paste while generating or typing;
 * after generate ends, wait full COORD_IDLE_SETTLE_MS before idle inject.
 * Stable draft ≥ COORD_STUCK_DRAFT_SEC → deliver with restore (AFK stuck-draft).
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

  // Operator / prove bypass — paste even with draft (inject restores human draft).
  if (inboxSkipTypingGate()) {
    return { phase: "idle", canDeliver: true };
  }

  if (state.phase === "busy") {
    st.wasBusy = true;
    st.idleReadySince = 0;
    st.draftFp = "";
    st.draftSince = 0;
    return { phase: "wait-busy", canDeliver: false };
  }

  if (st.wasBusy) {
    st.wasBusy = false;
    st.lastBusyEndedAt = nowMs;
    st.idleReadySince = 0;
  }

  const draftFp =
    state.draftFingerprint?.trim() ||
    coordComposerDraft(stripMeshForDraft(captureTail), providerId) ||
    undefined;
  const draftAgeSec = trackDraftAge(st, draftFp, nowMs);
  const holdTyping =
    !inboxSkipTypingGate() && (state.phase === "typing" || Boolean(draftFp));
  if (holdTyping) {
    st.idleReadySince = 0;
    if (COORD_STUCK_DRAFT_SEC > 0 && draftAgeSec >= COORD_STUCK_DRAFT_SEC) {
      // AFK: same fingerprint long enough — inject will save/clear/restore.
      return {
        phase: "idle",
        canDeliver: true,
        draftFp,
        clearInSec: 0,
      };
    }
    const clearInSec =
      COORD_STUCK_DRAFT_SEC > 0
        ? Math.max(0, Math.ceil(COORD_STUCK_DRAFT_SEC - draftAgeSec))
        : undefined;
    return { phase: "wait-typing", canDeliver: false, draftFp, clearInSec };
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

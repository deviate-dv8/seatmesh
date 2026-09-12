/**
 * Sole daemon inject path: registry.detect -> provider.injectPlan -> injectToPane.
 */
import { spawnSync } from "node:child_process";
import type { ComposerState, ProviderRegistry } from "seat-mesh-core";
import { capturePaneSnapshot, injectToPane, paneMetaForPane } from "seat-mesh-tmux";
import { classifyCoordDelivery } from "./compose-gate.js";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

/** Soft post-check: injected text visible in scrollback (best-effort; steer may hide). */
export function verifyInjectVisible(paneId: string, message: string): boolean {
  sleepMs(350);
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const tail = snap.captureTail;
  const body = message.trim();
  if (!body) return false;
  const head = body.slice(0, 48);
  const tailSlice = body.length > 48 ? body.slice(-48) : body;
  return tail.includes(head) || tail.includes(tailSlice);
}

/** When may the daemon paste into this pane? */
export function canDeliverNow(
  state: ComposerState,
  captureTail: string,
  providerId: string,
): boolean {
  if (state.phase === "plain_shell" || state.phase === "limit") return false;
  if (state.phase === "empty" || state.phase === "afk") return true;

  if (providerId === "cursor-agent" || providerId === "agent") {
    if (state.phase === "busy" && state.busyLabel === "follow-up") return true;
    if (/Add a follow-up|ctrl\+c to stop/.test(captureTail)) return true;
    if (state.phase === "busy") return false;
    if (state.phase === "typing" && /Add a follow-up/.test(captureTail)) return true;
    return false;
  }

  if (providerId === "opencode") {
    // empty/afk already returned true above; remaining phases are busy/typing.
    return false;
  }

  return false;
}

function isCoordPane(paneId: string): boolean {
  const meta = paneMetaForPane(paneId);
  return meta?.role === "manager" || meta?.role === "secretary";
}

/** Cursor follow-up composer accepts steer injects (coord + worker parity). */
export function isCursorFollowUpSteer(
  state: ComposerState,
  captureTail: string,
  providerId: string,
): boolean {
  if (providerId !== "cursor-agent" && providerId !== "agent") return false;
  if (state.phase === "busy" && state.busyLabel === "follow-up") return true;
  return /Add a follow-up|ctrl\+c to stop/.test(captureTail);
}

export type DeliverResult =
  | { ok: true; providerId: string; mode: "idle" | "steer"; verified: boolean }
  | { ok: false; reason: string };

export interface DeliverOptions {
  /** Skip post-inject scrollback verify (checkback renew path). */
  skipVerify?: boolean;
  /** ACK/FYI class — deliver when busy; hub stays rank-1 (PEER-BACKLOG-SPEC). */
  lightweight?: boolean;
  /** Room thin-ping — bypass manager/secretary coord idle-settle gate. */
  roomPing?: boolean;
}

export function deliverToPane(
  paneId: string,
  message: string,
  registry: ProviderRegistry,
  opts: DeliverOptions = {},
): DeliverResult {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return { ok: false, reason: "no_snapshot" };

  const prov = registry.detect(snap);
  if (!prov) return { ok: false, reason: "no_provider" };

  const state = prov.composerState(snap);
  const coord = isCoordPane(paneId);
  const followUpSteer = isCursorFollowUpSteer(state, snap.captureTail, prov.id);

  if (coord && !opts.roomPing && !followUpSteer) {
    const gate = classifyCoordDelivery(paneId, state, snap.captureTail, prov.id);
    if (!gate.canDeliver) {
      const extra =
        gate.settleInSec != null
          ? `:settle ${gate.settleInSec}s`
          : gate.draftFp
            ? `:draft`
            : "";
      return { ok: false, reason: `held:coord:${gate.phase}${extra}` };
    }
  } else if (
    !opts.lightweight &&
    !opts.roomPing &&
    !followUpSteer &&
    !canDeliverNow(state, snap.captureTail, prov.id)
  ) {
    return { ok: false, reason: `held:${state.phase}${state.busyLabel ? `:${state.busyLabel}` : ""}` };
  }

  const steer =
    !opts.lightweight &&
    (followUpSteer ||
      (!coord &&
        (state.phase === "busy" ||
          (state.phase === "typing" && /Add a follow-up/.test(snap.captureTail)))));

  const plan = prov.injectPlan(snap);
  injectToPane(paneId, message, plan, prov.id, snap.captureTail);
  const mode = steer ? "steer" : "idle";
  // OpenCode TUI often hides pasted prompt in capture-pane tail (verify false negative).
  const verified =
    opts.skipVerify ||
    prov.id === "opencode" ||
    prov.id === "claude" ||
    prov.id === "agent" ||
    mode === "steer" ||
    verifyInjectVisible(paneId, message);
  if (!verified) {
    return { ok: false, reason: "inject_unverified" };
  }
  return { ok: true, providerId: prov.id, mode, verified };
}

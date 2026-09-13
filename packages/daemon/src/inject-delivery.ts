/**
 * Sole daemon inject path: registry.detect -> provider.injectPlan -> injectToPane.
 */
import { spawnSync } from "node:child_process";
import type { ComposerState, LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  formatMeshInboxStamp,
  isCoordKind,
  isHumanCoTypedColumn,
  MESH_INBOX_ROOM_TAG,
  MESH_INBOX_TAG,
  type MeshInboxIntent,
  stripReplyPeerFooter,
} from "@seat-mesh/core";
import { capturePaneSnapshot, injectToPane, paneMetaForPane } from "@seat-mesh/tmux";
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
  return Boolean(meta?.role && isCoordKind(meta.role));
}

/**
 * Human-co-typed coord pane (FQ-inject-co-typed-pane, default: manager-2) — a
 * human directly types in this same pane as the CLI, so even a "thin" room
 * ping must never bypass the busy/typing gate the way it does for pure
 * agent-to-agent coord panes (that bypass was the observed footer-bleed).
 */
function isHumanCoTypedPane(paneId: string, loaded?: LoadedProfile): boolean {
  const meta = paneMetaForPane(paneId);
  if (!meta?.role) return false;
  return isHumanCoTypedColumn(meta.role, loaded?.profile.layout);
}

/** Cursor follow-up composer accepts steer injects (coord + worker parity). */
export function isCursorFollowUpSteer(
  state: ComposerState,
  captureTail: string,
  providerId: string,
): boolean {
  // Claude: never steer-inject while generating — Esc aborts auto mode.
  if (providerId === "claude") return false;
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
  /** Passive STATUS / supervise tick — skip compose-gate (operator: force-send to secretary). */
  force?: boolean;
  /** Machine intent for coord filtering (checkback-verify, continue, …). */
  intent?: MeshInboxIntent;
  /** Resolves layout.base.humanCoTyped for the co-typed-pane gate (FQ-inject-co-typed-pane). */
  loaded?: LoadedProfile;
}

/** operator standing: every daemon paste is tagged so coord panes can filter (draft-preserve, STATUS). */
export function stampDaemonInject(message: string, intent?: MeshInboxIntent): string {
  let body = message;
  if (intent && intent !== "assign") {
    body = stripReplyPeerFooter(body);
  }
  const t = body.trimStart();
  if (t.startsWith(MESH_INBOX_TAG) || t.startsWith(MESH_INBOX_ROOM_TAG)) {
    return formatMeshInboxStamp(body, intent);
  }
  return formatMeshInboxStamp(`${MESH_INBOX_TAG} ${t}`, intent);
}

export function deliverToPane(
  paneId: string,
  message: string,
  registry: ProviderRegistry,
  opts: DeliverOptions = {},
): DeliverResult {
  message = stampDaemonInject(message, opts.intent);
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return { ok: false, reason: "no_snapshot" };

  const prov = registry.detect(snap);
  if (!prov) return { ok: false, reason: "no_provider" };

  const state = prov.composerState(snap);
  const coord = isCoordPane(paneId);
  const coTyped = coord && isHumanCoTypedPane(paneId, opts.loaded);

  // Hard floor for humanCoTyped panes (FQ-inject-co-typed-pane): busy/typing never
  // pastes here, full stop — not even `force`/`roomPing`, which exist precisely to
  // bypass the ordinary coord gate and were themselves observed pasting mid-keystroke
  // (a forced balance-lead-tick STATUS interleaving with live operator typing).
  if (coTyped && (state.phase === "busy" || state.phase === "typing")) {
    return { ok: false, reason: `held:cotyped:${state.phase}` };
  }

  // Co-typed panes never get the thin-room-ping bypass either — a "status" ping
  // pasted mid-keystroke is exactly the tty-interleaving bug this gate stops.
  const roomPingBypass = opts.roomPing === true && !coTyped;
  const followUpSteer = isCursorFollowUpSteer(state, snap.captureTail, prov.id);

  if (!opts.force && coord && !roomPingBypass && !followUpSteer) {
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
    !opts.force &&
    !opts.lightweight &&
    !roomPingBypass &&
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

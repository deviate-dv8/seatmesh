/**
 * Sole daemon inject path: registry.detect -> provider.injectPlan -> injectToPane.
 */
import { spawnSync } from "node:child_process";
import type { ComposerState, LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  formatMeshInboxStamp,
  isCoordKind,
  isHumanCoTypedColumn,
  isSuperviseStatusBroadcast,
  MESH_INBOX_ROOM_TAG,
  MESH_INBOX_TAG,
  type MeshInboxIntent,
  stripReplyPeerFooter,
} from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  injectToPane,
  paneMetaForPane,
  sendDesktopToastSync,
} from "@seat-mesh/tmux";
import { classifyCoordDelivery, inboxSkipTypingGate } from "./compose-gate.js";

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
    // Follow-up box is NOT a delivery lane. Steer-paste there becomes the
    // next user turn and the agent drops the in-flight instruction.
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
 * Human-co-typed coord pane (FQ-inject-co-typed-pane, profile humanCoTyped) — a
 * human directly types in this same pane as the CLI, so even a "thin" room
 * ping must never bypass the busy/typing gate the way it does for pure
 * agent-to-agent coord panes (that bypass was the observed footer-bleed).
 */
function isHumanCoTypedPane(paneId: string, loaded?: LoadedProfile): boolean {
  const meta = paneMetaForPane(paneId);
  if (!meta?.role) return false;
  return isHumanCoTypedColumn(meta.role, loaded?.profile.layout);
}

/** Follow-up UI detector only — never a delivery bypass (steals the next user turn). */
export function isCursorFollowUpSteer(
  state: ComposerState,
  captureTail: string,
  providerId: string,
): boolean {
  if (providerId === "claude") return false;
  if (providerId !== "cursor-agent" && providerId !== "agent") return false;
  if (state.phase === "busy" && state.busyLabel === "follow-up") return true;
  return /Add a follow-up|ctrl\+c to stop/.test(captureTail);
}

/** Only these words may paste onto a busy/typing pane (not force/roomPing/ACK). */
export function isExplicitHubOverride(message: string): boolean {
  return /\bPRIORITY\b|\bSTOP other work\b/i.test(message);
}

const coTypedToastLastByPane = new Map<string, number>();
const COTYPED_TOAST_MIN_MS = 10 * 60 * 1000;

/** Mechanical mesh traffic must not desktop-notify the operator (room tail is enough). */
export function coTypedNotifyEligible(message: string): boolean {
  if (isSuperviseStatusBroadcast(undefined, message)) return false;
  const t = message.trim();
  if (/^\[mesh-inbox\]\s*(SUPERVISE-STATUS|BALANCE-STATUS|BALANCE:|SUPERVISE:)/i.test(t)) {
    return false;
  }
  if (/^\[mesh-inbox\]\s*Check:/i.test(t) || /^Check:\s/i.test(t)) return false;
  if (/\[mesh-inbox-room\][^\n]*\|\s*status\b/i.test(t)) return false;
  if (/\[mesh-inbox-room\][^\n]*\|\s*fyi\b/i.test(t)) return false;
  if (/^FYI:\s*mini-\d+/i.test(t)) return false;
  if (/^ACK managers tail/i.test(t)) return false;
  if (/^Verify:\s*seatmesh.*room tail/i.test(t) && /SHELL \(required/i.test(t)) return false;
  return true;
}

export function shouldSendCoTypedHoldToast(paneId: string, message: string): boolean {
  if (process.env.MESH_COTYPED_NOTIFY === "0" || process.env.ZSIGN_SKIP_COTYPED_NOTIFY) {
    return false;
  }
  if (!coTypedNotifyEligible(message)) return false;
  if (/\b(PRIORITY|STOP other work|ASSIGN|PROPOSAL|Dan notify reply)\b/i.test(message)) {
    return true;
  }
  const now = Date.now();
  const last = coTypedToastLastByPane.get(paneId) ?? 0;
  if (now - last < COTYPED_TOAST_MIN_MS) return false;
  coTypedToastLastByPane.set(paneId, now);
  return true;
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
  /** Workspace root for co-typed notify-only toasts (FQ proposal). */
  workspace?: string;
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

  // Hard floor: busy/typing never gets an inbox paste. Cursor follow-up
  // steer was the leak — the inject became the next user turn and the
  // in-flight instruction was dropped. Queue/backlog instead.
  // PRIORITY / STOP other work may paste except on humanCoTyped panes.
  const typingHold =
    state.phase === "typing" && !inboxSkipTypingGate();
  const busyHold = state.phase === "busy";
  if (busyHold || typingHold) {
    if (coTyped || !isExplicitHubOverride(message)) {
      const phase = busyHold ? "busy" : "typing";
      if (coTyped && opts.workspace && shouldSendCoTypedHoldToast(paneId, message)) {
        const role = paneMetaForPane(paneId)?.role ?? "coord";
        sendDesktopToastSync(
          opts.workspace,
          `mesh co-typed ${role}`,
          message.trim().slice(0, 200),
        );
      }
      return {
        ok: false,
        reason: coTyped ? `held:cotyped:${phase}` : `held:${phase}`,
      };
    }
  }

  // Co-typed panes never get the thin-room-ping bypass either — a "status" ping
  // pasted mid-keystroke is exactly the tty-interleaving bug this gate stops.
  const roomPingBypass = opts.roomPing === true && !coTyped;

  if (!opts.force && coord && !roomPingBypass) {
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
    !canDeliverNow(state, snap.captureTail, prov.id)
  ) {
    return { ok: false, reason: `held:${state.phase}${state.busyLabel ? `:${state.busyLabel}` : ""}` };
  }

  const steer = false;

  const plan = {
    ...prov.injectPlan(snap),
    ...(coTyped ? { skipSubmit: true } : {}),
  };
  injectToPane(paneId, message, plan, prov.id, snap.captureTail, snap.captureTailAnsi);
  const mode = steer ? "steer" : "idle";
  // OpenCode TUI often hides pasted prompt in capture-pane tail (verify false negative).
  const verified =
    opts.skipVerify ||
    prov.id === "opencode" ||
    prov.id === "claude" ||
    prov.id === "agent" ||
    prov.id === "cursor-agent" ||
    mode === "steer" ||
    verifyInjectVisible(paneId, message);
  if (!verified) {
    return { ok: false, reason: "inject_unverified" };
  }
  return { ok: true, providerId: prov.id, mode, verified };
}

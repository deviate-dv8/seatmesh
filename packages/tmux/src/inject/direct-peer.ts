import type { ComposerState, ProviderRegistry } from "@seat-mesh/core";
import { formatPeerReplyCmd } from "@seat-mesh/core";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { injectToPane } from "./inject.js";
import { resolvePaneTarget, type ResolvePaneContext } from "../lib/resolve-pane.js";

function canDeliverPeer(state: ComposerState, providerId: string, captureTail: string): boolean {
  if (state.phase === "plain_shell" || state.phase === "limit") return false;
  if (state.phase === "empty" || state.phase === "afk") return true;
  if (providerId === "cursor-agent" || providerId === "agent") {
    if (state.phase === "busy" && state.busyLabel === "follow-up") return true;
    if (/Add a follow-up|ctrl\+c to stop/.test(captureTail)) return true;
    return false;
  }
  if (providerId === "opencode") {
    return state.phase === "typing";
  }
  return false;
}

export type DirectPeerResult =
  | { ok: true; paneId: string; providerId: string; mode: "idle" | "steer" | "bypass" }
  | { ok: false; reason: string; paneId?: string };

/** Immediate paste when pane idle. Falls back to enqueue when busy. */
export function tryDirectPeerInject(
  registry: ProviderRegistry,
  ctx: ResolvePaneContext,
  target: string,
  message: string,
): DirectPeerResult {
  const resolved = resolvePaneTarget(target, ctx);
  if ("error" in resolved) {
    return { ok: false, reason: resolved.error };
  }

  const snap = capturePaneSnapshot(resolved.paneId);
  if (!snap) return { ok: false, reason: "no_snapshot" };

  const prov = registry.detect(snap);
  if (!prov) return { ok: false, reason: "no_provider", paneId: resolved.paneId };

  const state = prov.composerState(snap);
  if (!canDeliverPeer(state, prov.id, snap.captureTail)) {
    return {
      ok: false,
      reason: `held:${state.phase}${state.busyLabel ? `:${state.busyLabel}` : ""}`,
      paneId: resolved.paneId,
    };
  }

  const steer =
    state.phase === "busy" ||
    (state.phase === "typing" && /Add a follow-up/.test(snap.captureTail));
  const plan = prov.injectPlan(snap);
  injectToPane(
    resolved.paneId,
    message,
    plan,
    prov.id,
    snap.captureTail,
    snap.captureTailAnsi,
  );
  return {
    ok: true,
    paneId: resolved.paneId,
    providerId: prov.id,
    mode: steer ? "steer" : "idle",
  };
}

/** Inbox-down bypass: paste even when composer is busy (never plain_shell). */
export function forceDirectPeerInject(
  registry: ProviderRegistry,
  ctx: ResolvePaneContext,
  target: string,
  message: string,
): DirectPeerResult {
  const resolved = resolvePaneTarget(target, ctx);
  if ("error" in resolved) {
    return { ok: false, reason: resolved.error };
  }

  const snap = capturePaneSnapshot(resolved.paneId);
  if (!snap) return { ok: false, reason: "no_snapshot" };

  const prov = registry.detect(snap);
  if (!prov) return { ok: false, reason: "no_provider", paneId: resolved.paneId };

  const state = prov.composerState(snap);
  if (state.phase === "plain_shell") {
    return { ok: false, reason: "plain_shell", paneId: resolved.paneId };
  }

  const plan = prov.injectPlan(snap);
  injectToPane(
    resolved.paneId,
    message,
    plan,
    prov.id,
    snap.captureTail,
    snap.captureTailAnsi,
  );
  return {
    ok: true,
    paneId: resolved.paneId,
    providerId: prov.id,
    mode: "bypass",
  };
}

export function harnessToSlotMessage(
  fromSlot: string,
  fromPorts: string,
  destSlot: string,
  report: string,
): string {
  const text = report.trim();
  return `[agent-worker-slot-${fromSlot}] TO-SLOT-${destSlot} (${fromPorts}): ${text} — reply ${formatPeerReplyCmd(`slot-${fromSlot}`)}`;
}

export function harnessRoomMentionMessage(
  fromAgent: string,
  slug: string,
  body: string,
): string {
  return `[mesh-peer] @room ${slug} from ${fromAgent}: ${body.trim()}`;
}

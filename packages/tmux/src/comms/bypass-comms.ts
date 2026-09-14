import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { forceDirectPeerInject, tryDirectPeerInject } from "../inject/direct-peer.js";
import { meshInboxPort, probeInbox } from "./inbox-bridge.js";

/** True when daemon /health responds (peer queue available). */
export function isInboxUp(loaded: LoadedProfile): boolean {
  return probeInbox(meshInboxPort(loaded)) === "healthy";
}

/** stderr warning — bypass sends are not persisted to PEER.jsonl / inbox history. */
export function warnBypassComms(targetLabel: string, detail?: string): void {
  const tail = detail ? ` (${detail})` : "";
  console.error(
    `WARN: bypass comms -> ${targetLabel}${tail} — inbox unavailable; direct inject only, NOT saved to peer history`,
  );
}

export interface BypassPeerResult {
  ok: boolean;
  mode?: "idle" | "steer" | "bypass";
  paneId?: string;
  reason?: string;
}

/**
 * When inbox is down: direct inject with WARN (no PEER.jsonl row).
 * Tries idle steer first, then force paste.
 */
export function bypassPeerDeliver(
  registry: ProviderRegistry,
  loaded: LoadedProfile,
  resolveTarget: string,
  targetLabel: string,
  msg: string,
  detail?: string,
): BypassPeerResult {
  warnBypassComms(targetLabel, detail);
  const direct = tryDirectPeerInject(registry, loaded, resolveTarget, msg);
  if (direct.ok) {
    return { ok: true, mode: direct.mode, paneId: direct.paneId };
  }
  const forced = forceDirectPeerInject(registry, loaded, resolveTarget, msg);
  if (forced.ok) {
    return { ok: true, mode: forced.mode, paneId: forced.paneId };
  }
  return { ok: false, reason: forced.reason ?? direct.reason };
}

/** Registry + bypass helper for call sites that do not already hold one. */
export function bypassPeerDeliverLoaded(
  loaded: LoadedProfile,
  resolveTarget: string,
  targetLabel: string,
  msg: string,
  detail?: string,
): BypassPeerResult {
  const registry = createRegistryForProfile(loaded.profile);
  return bypassPeerDeliver(registry, loaded, resolveTarget, targetLabel, msg, detail);
}

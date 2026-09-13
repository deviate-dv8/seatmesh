import {
  capturePaneSnapshot,
  hasDeliveredColdStartPeer,
  hasPendingColdStartPeer,
  isPaneContextReady,
} from "@seat-mesh/tmux";
import type { ProviderRegistry } from "@seat-mesh/core";
import type { MeshOrchestratorCtx } from "../orchestrator/mesh-orchestrator.js";

export interface DeliveryHoldResult {
  hold: boolean;
  reason?: string;
}

function isOpenCodePane(registry: ProviderRegistry, paneId: string): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  return registry.detect(snap)?.id === "opencode";
}

/** Gate peer/inbox inject: OC limit, proxy-down (OC only), context-not-ready (post-replace). */
export function deliveryHoldForPane(
  ctx: MeshOrchestratorCtx,
  targetPane: string,
  opts: { isColdStart?: boolean; allowCheckbackComms?: boolean } = {},
): DeliveryHoldResult {
  if (ctx.ocLimitedPaneIds.has(targetPane)) {
    return { hold: true, reason: "held:limit" };
  }
  if (ctx.proxyDownActive && isOpenCodePane(ctx.registry, targetPane)) {
    return { hold: true, reason: "held:proxy-down" };
  }
  if (!opts.isColdStart) {
    const pending = hasPendingColdStartPeer(ctx.loaded, targetPane);
    const ready = isPaneContextReady(ctx.loaded, targetPane);
    if (!ready && pending) {
      if (
        opts.allowCheckbackComms &&
        hasDeliveredColdStartPeer(ctx.loaded, targetPane)
      ) {
        // Duplicate FRESH SUMMON queued — Check:/room verify must not wedge forever.
      } else {
        return { hold: true, reason: "held:context-pending" };
      }
    } else if (!ready) {
      return { hold: true, reason: "held:context-pending" };
    }
  }
  return { hold: false };
}

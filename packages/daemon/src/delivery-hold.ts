import { capturePaneSnapshot, isPaneContextReady } from "@seat-mesh/tmux";
import type { ProviderRegistry } from "@seat-mesh/core";
import type { MeshOrchestratorCtx } from "./mesh-orchestrator.js";

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
  opts: { isColdStart?: boolean } = {},
): DeliveryHoldResult {
  if (ctx.ocLimitedPaneIds.has(targetPane)) {
    return { hold: true, reason: "held:limit" };
  }
  if (ctx.proxyDownActive && isOpenCodePane(ctx.registry, targetPane)) {
    return { hold: true, reason: "held:proxy-down" };
  }
  if (!opts.isColdStart && !isPaneContextReady(ctx.loaded, targetPane)) {
    return { hold: true, reason: "held:context-pending" };
  }
  return { hold: false };
}

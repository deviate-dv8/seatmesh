import { describe, expect, it } from "vitest";
import type { LoadedProfile, ProviderRegistry } from "seat-mesh-core";
import { deliveryHoldForPane } from "./delivery-hold.js";
import type { MeshOrchestratorCtx } from "./mesh-orchestrator.js";

function stubCtx(
  workspace: string,
  opts: { ocLimited?: Set<string>; proxyDown?: boolean } = {},
): MeshOrchestratorCtx {
  return {
    loaded: {
      workspace,
      profileDir: workspace,
      profilePath: "",
      profile: {} as LoadedProfile["profile"],
      workspaceId: "test01",
      sessionName: "mesh-test01",
    } satisfies LoadedProfile,
    registry: { detect: () => null } as unknown as ProviderRegistry,
    store: {} as MeshOrchestratorCtx["store"],
    session: "mesh",
    baseWindow: "base",
    workersWindow: "workers",
    minisWindow: "minis",
    log: () => {},
    ocLimitedPaneIds: opts.ocLimited ?? new Set(),
    proxyDownActive: opts.proxyDown ?? false,
  };
}

describe("deliveryHoldForPane", () => {
  it("holds non-cold-start when OC limit active on pane", () => {
    const ctx = stubCtx("/tmp/x", { ocLimited: new Set(["%1"]) });
    expect(deliveryHoldForPane(ctx, "%1", { isColdStart: false }).reason).toBe("held:limit");
    expect(deliveryHoldForPane(ctx, "%1", { isColdStart: true }).hold).toBe(true);
  });

  it("passes when pane not limited and no context gate", () => {
    const ctx = stubCtx("/tmp/x");
    expect(deliveryHoldForPane(ctx, "%9", { isColdStart: false }).hold).toBe(false);
  });
});

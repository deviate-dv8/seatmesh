import { describe, expect, it } from "vitest";
import { createBuiltinRegistry, normalizeProviderEnableIds, resolveKindsForProfile } from "./builtin.js";

describe("normalizeProviderEnableIds", () => {
  it("maps opencode-cpe / oc aliases to opencode provider", () => {
    expect(normalizeProviderEnableIds(["opencode-cpe", "oc", "cursor"])).toEqual([
      "opencode",
      "cursor-agent",
    ]);
  });

  it("maps legacy providers: oc-proxy to opencode (pia/zsign config)", () => {
    expect(normalizeProviderEnableIds(["oc-proxy", "claude"])).toEqual(["opencode", "claude"]);
  });

  it("keeps unknown kinds for future providers", () => {
    expect(normalizeProviderEnableIds(["kimi", "claude"])).toEqual(["kimi", "claude"]);
  });
});

describe("createBuiltinRegistry", () => {
  it("enables opencode detect when profile lists opencode-cpe", () => {
    const reg = createBuiltinRegistry(["cursor-agent", "opencode-cpe", "empty"]);
    expect(reg.get("opencode")).toBeTruthy();
    expect(reg.get("cursor-agent")).toBeTruthy();
    expect(reg.get("claude")).toBeUndefined();
  });
});

describe("resolveKindsForProfile", () => {
  it("emits opencode-cpe as extension of opencode from provider kindBase", () => {
    const kinds = resolveKindsForProfile({
      providers: ["opencode", "empty"],
      agents: { runners: {}, kinds: {} },
    });
    expect(kinds.opencode.provider).toBe("opencode");
    expect(kinds["opencode-cpe"].provider).toBe("opencode");
    expect(kinds["opencode-cpe"].launch).toMatchObject({
      command: "scripts/opencode-cpe.sh",
    });
  });

  it("runners.oc-proxy shim lands on opencode-cpe launch", () => {
    const kinds = resolveKindsForProfile({
      providers: ["oc-proxy", "empty"],
      agents: {
        runners: { "oc-proxy": "scripts/from-legacy-key.sh" },
        kinds: {},
      },
    });
    expect(kinds["opencode-cpe"].launch).toEqual({ command: "scripts/from-legacy-key.sh" });
  });
});

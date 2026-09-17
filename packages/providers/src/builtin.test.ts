import { describe, expect, it } from "vitest";
import { createBuiltinRegistry, normalizeProviderEnableIds, resolveKindsForProfile } from "./builtin.js";

describe("normalizeProviderEnableIds", () => {
  it("maps oc-proxy / oc aliases to opencode provider", () => {
    expect(normalizeProviderEnableIds(["oc-proxy", "oc", "cursor"])).toEqual([
      "opencode",
      "cursor-agent",
    ]);
  });

  it("keeps unknown kinds for future providers", () => {
    expect(normalizeProviderEnableIds(["kimi", "claude"])).toEqual(["kimi", "claude"]);
  });
});

describe("createBuiltinRegistry", () => {
  it("enables opencode detect when profile lists oc-proxy", () => {
    const reg = createBuiltinRegistry(["cursor-agent", "oc-proxy", "empty"]);
    expect(reg.get("opencode")).toBeTruthy();
    expect(reg.get("cursor-agent")).toBeTruthy();
    expect(reg.get("claude")).toBeUndefined();
  });
});

describe("resolveKindsForProfile", () => {
  it("emits oc-proxy as extension of opencode from provider kindBase", () => {
    const kinds = resolveKindsForProfile({
      providers: ["opencode", "empty"],
      agents: { runners: {}, kinds: {} },
    });
    expect(kinds.opencode.provider).toBe("opencode");
    expect(kinds["oc-proxy"].provider).toBe("opencode");
    expect(kinds["oc-proxy"].launch).toMatchObject({
      command: "scripts/opencode-cpe.sh",
    });
  });

  it("mesh agents.kinds overlay wins on launch", () => {
    const kinds = resolveKindsForProfile({
      providers: ["opencode"],
      agents: {
        runners: {},
        kinds: {
          "oc-proxy": { launch: { command: "scripts/custom-cpe.sh" } },
        },
      },
    });
    expect(kinds["oc-proxy"].launch).toEqual({ command: "scripts/custom-cpe.sh" });
  });
});

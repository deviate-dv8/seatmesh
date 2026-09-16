import { describe, expect, it } from "vitest";
import { createBuiltinRegistry, normalizeProviderEnableIds } from "./builtin.js";

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

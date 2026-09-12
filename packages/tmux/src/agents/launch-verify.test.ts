import { describe, expect, it } from "vitest";
import { isOpenCodeLaunch, normalizeHarnessType } from "./launch-verify.js";

describe("launch-verify", () => {
  it("normalizeHarnessType maps cursor-agent", () => {
    expect(normalizeHarnessType("cursor-agent")).toBe("agent");
  });

  it("isOpenCodeLaunch detects opencode type and cpe script", () => {
    expect(isOpenCodeLaunch("opencode", null)).toBe(true);
    expect(isOpenCodeLaunch("agent", "cd /w && /w/scripts/opencode-cpe.sh")).toBe(true);
    expect(isOpenCodeLaunch("agent", "agent --workspace /w")).toBe(false);
    expect(isOpenCodeLaunch("claude", null)).toBe(false);
  });
});

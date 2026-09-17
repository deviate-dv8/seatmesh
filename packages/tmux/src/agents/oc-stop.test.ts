import { describe, expect, it } from "vitest";
import { isOpenCodeHarnessType, openCodePaneBusy } from "./oc-stop.js";

describe("oc-stop", () => {
  it("recognizes opencode harness kinds", () => {
    expect(isOpenCodeHarnessType("oc-proxy")).toBe(true);
    expect(isOpenCodeHarnessType("opencode")).toBe(true);
    expect(isOpenCodeHarnessType("claude")).toBe(false);
  });

  it("detects busy OC generation from capture tail", () => {
    expect(openCodePaneBusy("Build auto\n esc interrupt\n")).toBe(true);
    expect(openCodePaneBusy("Ask anything…\n ctrl+p commands")).toBe(false);
  });
});

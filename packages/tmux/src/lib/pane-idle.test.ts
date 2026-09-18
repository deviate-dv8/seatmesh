import { describe, expect, it } from "vitest";
import { cmdlineLooksLikeAgent, isPlainShellCommand } from "./pane-idle.js";

describe("pane-idle", () => {
  it("treats bare shells as plain", () => {
    expect(isPlainShellCommand("bash")).toBe(true);
    expect(isPlainShellCommand("zsh")).toBe(true);
    expect(isPlainShellCommand("")).toBe(true);
    expect(isPlainShellCommand("opencode")).toBe(false);
  });

  it("detects wrapped CPE / OC / agent cmdlines", () => {
    expect(
      cmdlineLooksLikeAgent(
        "bash /home/dan/Desktop/Work/zsign/.sm/runtime/welcome/oc-_36-_36.sh",
      ),
    ).toBe(false);
    expect(
      cmdlineLooksLikeAgent(
        "/home/dan/Desktop/Work/zsign/scripts/opencode-cpe.sh --session ses_abc",
      ),
    ).toBe(true);
    expect(cmdlineLooksLikeAgent("opencode --auto")).toBe(true);
    expect(cmdlineLooksLikeAgent("agent --resume x")).toBe(true);
    expect(cmdlineLooksLikeAgent("claude")).toBe(true);
  });
});

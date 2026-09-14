import { describe, expect, it } from "vitest";
import { classifyPaneSurface } from "./pane-kind.js";

describe("classifyPaneSurface", () => {
  it("empty provider => terminal", () => {
    expect(classifyPaneSurface({ providerId: "empty", phase: "plain_shell", cmd: "zsh" })).toBe(
      "terminal",
    );
  });

  it("known agent providers => agent", () => {
    for (const providerId of ["claude", "opencode", "cursor", "kiro"]) {
      expect(classifyPaneSurface({ providerId, phase: "idle", cmd: "node" })).toBe("agent");
      expect(classifyPaneSurface({ providerId, phase: "busy", cmd: "node" })).toBe("agent");
    }
  });

  it("unknown + shell cmd => terminal", () => {
    expect(classifyPaneSurface({ providerId: "unknown", phase: "plain_shell", cmd: "zsh" })).toBe(
      "terminal",
    );
  });

  it("unknown + non-shell => unknown", () => {
    expect(classifyPaneSurface({ providerId: "unknown", phase: "idle", cmd: "python" })).toBe(
      "unknown",
    );
  });
});

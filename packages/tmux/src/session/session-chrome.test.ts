import { describe, expect, it } from "vitest";
import { meshStatusLeft, workspaceFolderLabel } from "./session-chrome.js";

describe("meshStatusLeft", () => {
  it("formats [folder][session] with trailing space", () => {
    expect(meshStatusLeft("seatmesh", "mesh-c87d62")).toBe("[seatmesh][mesh-c87d62] ");
  });

  it("is longer than tmux default status-left-length 10 (truncation bug)", () => {
    const left = meshStatusLeft("seatmesh", "mesh-c87d62");
    expect(left.length).toBeGreaterThan(10);
    // Truncating to 10 must not be what we ship — that yields [mesh-c87d0:nvim
    expect(left.slice(0, 10)).not.toBe("[mesh-c87d");
  });
});

describe("workspaceFolderLabel", () => {
  it("uses basename", () => {
    expect(workspaceFolderLabel("/home/dan/Desktop/Projects/seatmesh")).toBe("seatmesh");
  });
});

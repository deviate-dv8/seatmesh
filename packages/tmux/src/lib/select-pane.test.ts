import { describe, expect, it } from "vitest";
import { pickActivePaneId } from "./select-pane.js";

describe("pickActivePaneId", () => {
  it("returns the pane marked active", () => {
    expect(pickActivePaneId("%1\t0\n%19\t1\n%18\t0")).toBe("%19");
  });

  it("returns null when none are active", () => {
    expect(pickActivePaneId("%1\t0\n%18\t0")).toBeNull();
  });

  it("ignores junk lines", () => {
    expect(pickActivePaneId("\nfoo\n%3\t1")).toBe("%3");
  });
});

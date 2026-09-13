import { describe, expect, it } from "vitest";
import { formatVersionUpgradeHint, semverLess } from "./version-nudge.js";

describe("version-nudge", () => {
  it("semverLess compares patch releases", () => {
    expect(semverLess("0.1.19", "0.1.20")).toBe(true);
    expect(semverLess("0.1.20", "0.1.20")).toBe(false);
    expect(semverLess("0.1.21", "0.1.20")).toBe(false);
  });

  it("upgrade hint mentions npm and npx paths", () => {
    const line = formatVersionUpgradeHint("0.1.18", "0.1.20");
    expect(line).toContain("npm install -g seatmesh@latest");
    expect(line).toContain("npx seatmesh@latest");
    expect(line).toContain("2026-09-14");
  });
});

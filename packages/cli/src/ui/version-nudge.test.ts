import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatHelpVersionBlock,
  formatVersionUpgradeHint,
  readProfileSeatmeshVersion,
  semverLess,
} from "./version-nudge.js";

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
    expect(line).toContain("this 0.1.18");
    expect(line).toContain("npm latest 0.1.20");
  });

  it("help version block shows installed, latest, and update howto", () => {
    const behind = formatHelpVersionBlock("1.0.2", "1.0.3", "global/npm");
    expect(behind.some((l) => l.includes("version 1.0.2"))).toBe(true);
    expect(behind.some((l) => l.includes("npm latest 1.0.3"))).toBe(true);
    expect(behind.some((l) => l.includes("update available"))).toBe(true);
    expect(behind.some((l) => l.includes("npm install -g seatmesh@latest"))).toBe(true);

    const current = formatHelpVersionBlock("1.0.3", "1.0.3", "dev checkout");
    expect(current.some((l) => l.includes("up to date"))).toBe(true);
    expect(current.some((l) => l.includes("dev checkout"))).toBe(true);

    const ahead = formatHelpVersionBlock("1.0.3", "1.0.2", "dev checkout");
    expect(ahead.some((l) => l.includes("ahead of npm"))).toBe(true);
  });

  describe("readProfileSeatmeshVersion", () => {
    let tmp = "";
    afterEach(() => {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("reads profile stamp file", () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-ver-"));
      fs.writeFileSync(path.join(tmp, ".seatmesh-version"), "1.0.1\n");
      expect(readProfileSeatmeshVersion(tmp)).toBe("1.0.1");
    });
  });
});

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const bin = path.join(repoRoot, "packages/cli/bin/seatmesh");

describe("todo give help surface", () => {
  it("help todo mentions give", () => {
    const r = spawnSync(bin, ["help", "todo"], { encoding: "utf8", cwd: repoRoot });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/todo give/);
    expect(r.stdout).toMatch(/shorthand/i);
  });

  it("todo without args prints give-first usage", () => {
    const r = spawnSync(bin, ["todo"], { encoding: "utf8", cwd: repoRoot });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/todo give/);
  });
});

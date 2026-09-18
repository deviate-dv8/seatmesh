/**
 * CLI speed budget — >1s wall for spawn --fast is a regression.
 * Needs live mesh tmux (skips otherwise).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const bin = path.join(repoRoot, "bin/seatmesh");
const inMesh = Boolean(process.env.TMUX_PANE) && Boolean(process.env.TMUX);

describe("cli speed budget", () => {
  it.skipIf(!inMesh)("spawn --fast wall clock < 1000ms", () => {
    // Ensure empty shell first (also must be fast)
    spawnSync(bin, ["switch", "slot-1", "empty", "--fast"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: process.env,
    });
    const t0 = Date.now();
    const r = spawnSync(bin, ["spawn", "slot-1", "opencode"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: process.env,
    });
    const ms = Date.now() - t0;
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/\[fast\]|already live|launched\[fast\]/);
    expect(ms, `spawn --fast took ${ms}ms (budget 1000ms)`).toBeLessThan(1000);
  });

  it("help spawn wall < 1000ms (cold-ish)", () => {
    const t0 = Date.now();
    const r = spawnSync(bin, ["help", "spawn"], { encoding: "utf8", cwd: repoRoot });
    const ms = Date.now() - t0;
    expect(r.status).toBe(0);
    expect(ms, `help spawn took ${ms}ms`).toBeLessThan(1000);
  });
});

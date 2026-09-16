import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const bin = path.join(repoRoot, "packages/cli/bin/seatmesh");

describe("operator help surfaces", () => {
  it("default help hides agent runtime block", () => {
    const r = spawnSync(bin, ["help"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, SEATMESH_SKIP_VERSION_CHECK: "1" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/human surface|operator CLI/i);
    expect(r.stdout).toMatch(/--agents help/);
    expect(r.stdout).not.toMatch(/Agent runtime \(pane/);
    expect(r.stdout).not.toMatch(/agent apply\|preflight/);
  });

  it("--agents help shows agent + human surface", () => {
    const r = spawnSync(bin, ["--agents", "help"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, SEATMESH_SKIP_VERSION_CHECK: "1" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Agent runtime/);
    expect(r.stdout).toMatch(/agent <cmd>/);
    expect(r.stdout).toMatch(/switch <target>/);
  });
});

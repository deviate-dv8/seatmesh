import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../setup/init.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const bin = path.join(repoRoot, "packages/cli/bin/seatmesh");

describe("todo give help surface", () => {
  it("help todo mentions give", () => {
    const r = spawnSync(bin, ["help", "todo"], { encoding: "utf8", cwd: repoRoot });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/todo give/);
    expect(r.stdout).toMatch(/shorthand/i);
  });

  describe("inside a mesh workspace", () => {
    // `todo` (unlike `help`) requires a real .sm/ workspace (the shim gates
    // non-allowlisted commands on `in_mesh_context`) — use an isolated tmp
    // workspace rather than the repo's own dogfooded .sm/, so this passes in
    // a clean checkout (e.g. the docker test runner) too.
    let tmp = "";

    afterEach(() => {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("todo without args prints give-first usage", () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-todo-"));
      runInit({ workspace: tmp, name: "todo-test" });
      const r = spawnSync(bin, ["todo"], { encoding: "utf8", cwd: tmp });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/todo give/);
    });
  });
});

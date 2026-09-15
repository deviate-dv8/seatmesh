import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "./init.js";
import { runUpdate } from "./update.js";

describe("runUpdate", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  function freshProfile(): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-update-"));
    runInit({ workspace: tmp, name: "upd" });
    const sm = path.join(tmp, ".sm");
    const cfg = path.join(sm, "mesh.config.yaml");
    const yaml = fs.readFileSync(cfg, "utf8").replace(/^(\s*slots:\s*)4$/m, "$16");
    fs.writeFileSync(cfg, yaml, "utf8");
    return sm;
  }

  it("refreshes _vendor file when template content differs (no folder wipe)", () => {
    const sm = freshProfile();
    runUpdate({ profileArg: sm });
    const vendor = path.join(sm, "roles", "_vendor", "common.yaml");
    fs.writeFileSync(vendor, "# stale vendor\n", "utf8");

    const r = runUpdate({ profileArg: sm });
    expect(r.refreshed.some((p) => p.endsWith("roles/_vendor/common.yaml"))).toBe(true);
    const body = fs.readFileSync(vendor, "utf8");
    expect(body).not.toContain("# stale vendor");
    expect(fs.readFileSync(path.join(sm, ".seatmesh-version"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("skips unchanged _vendor files", () => {
    const sm = freshProfile();
    runUpdate({ profileArg: sm });
    const r2 = runUpdate({ profileArg: sm });
    expect(r2.refreshed).toHaveLength(0);
    expect(r2.skipped.some((p) => p.includes("roles/_vendor/common.yaml"))).toBe(true);
  });

  it("dry-run does not write vendor or version stamp", () => {
    const sm = freshProfile();
    const vendor = path.join(sm, "roles", "_vendor", "common.yaml");
    fs.mkdirSync(path.dirname(vendor), { recursive: true });
    fs.writeFileSync(vendor, "# stale\n", "utf8");
    runUpdate({ profileArg: sm, dryRun: true });
    expect(fs.readFileSync(vendor, "utf8")).toBe("# stale\n");
    expect(fs.existsSync(path.join(sm, ".seatmesh-version"))).toBe(false);
  });

  it("migrates legacy profile: humanCoTyped + logs + seats/_shared", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-update-legacy-"));
    const sm = path.join(tmp, ".sm");
    fs.mkdirSync(path.join(sm, "roles", "_vendor"), { recursive: true });
    fs.writeFileSync(
      path.join(sm, "mesh.config.yaml"),
      [
        "name: legacy",
        "workspace: ..",
        "session:",
        "  name: mesh",
        "  workerCount: 1",
        "  miniMax: 1",
        "layout:",
        "  base:",
        "    window: base",
        "    columns: [manager, secretary]",
        "    cli:",
        "      manager: agent",
        "      secretary: opencode",
        "seats:",
        "  root: seats",
        "  templates: [FOCUS, TASKS, REMINDER]",
        "state:",
        "  agentsJson: agents.json",
        "  meshAgentsJson: mesh-agents.json",
        "daemon:",
        "  port: 31997",
        "  managerPromptPrefix: '[mgr]'",
        "ports:",
        "  worker: '30{n}0/30{n}1'",
        "providers: [cursor-agent]",
        "roles:",
        "  dir: roles",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(sm, "roles", "_vendor", "common.yaml"), "# stale\n");
    fs.writeFileSync(path.join(sm, "AGENTS.md"), "# stale agents\n");

    const r = runUpdate({ profileArg: sm });
    expect(r.configMerge?.added).toEqual(
      expect.arrayContaining(["layout.base.humanCoTyped", "layout.logs"]),
    );
    const cfg = fs.readFileSync(path.join(sm, "mesh.config.yaml"), "utf8");
    expect(cfg).toMatch(/humanCoTyped:/);
    expect(cfg).toMatch(/logs:/);
    expect(fs.existsSync(path.join(sm, "seats", "_shared", "NOTES.md"))).toBe(true);
    expect(fs.existsSync(path.join(sm, "seats", "_shared", "README.md"))).toBe(true);
    expect(fs.readFileSync(path.join(sm, "AGENTS.md"), "utf8")).toMatch(/Retrieval hub|agent hub/);
    expect(fs.readFileSync(path.join(sm, "roles", "_vendor", "common.yaml"), "utf8")).toMatch(
      /_shared/,
    );
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "./init.js";

describe("runInit", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates .sm with config and roles", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-init-"));
    const r = runInit({ workspace: tmp, name: "demo" });
    expect(fs.existsSync(r.configPath)).toBe(true);
    expect(fs.existsSync(path.join(r.smDir, "roles", "common.yaml"))).toBe(true);
    const yaml = fs.readFileSync(r.configPath, "utf8");
    expect(yaml).toContain("name: demo");
    expect(yaml).toContain("root: .sm/seats");
  });

  it("refuses overwrite without force", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-init-"));
    runInit({ workspace: tmp });
    expect(() => runInit({ workspace: tmp })).toThrow(/already exists/);
  });

  it("custom seatsRoot for migration (preserve external seat tree)", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-init-"));
    const seats = path.join(tmp, "tasks", "agent-seats");
    fs.mkdirSync(seats, { recursive: true });
    fs.writeFileSync(path.join(seats, "marker.txt"), "keep");
    runInit({ workspace: tmp, seatsRoot: "tasks/agent-seats" });
    const yaml = fs.readFileSync(path.join(tmp, ".sm", "mesh.config.yaml"), "utf8");
    expect(yaml).toContain("root: tasks/agent-seats");
    expect(fs.existsSync(path.join(seats, "marker.txt"))).toBe(true);
  });
});

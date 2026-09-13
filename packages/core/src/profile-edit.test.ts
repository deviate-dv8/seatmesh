import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProfile } from "./profile.js";
import { addBaseColumn, listBaseColumns, removeBaseColumn } from "./profile-edit.js";

const MINIMAL_CONFIG = `# fixture profile
name: fixture
workspace: ..

session:
  name: dev
  workerCount: 2
  miniMax: 4

layout:
  base:
    window: base
    columns: [manager, secretary]
    cli:
      manager: claude
    secretaryWidthPct: 40

seats:
  root: seats
  templates: [FOCUS, TASKS, REMINDER]

state:
  agentsJson: tmux-main-agents.json

daemon:
  port: 31699
  portScope: profile
  managerPromptPrefix: "[agent-manager]"

ports:
  worker: "30{n}0/30{n}1"

roles:
  dir: roles
`;

describe("profile-edit: base columns", () => {
  let tmp = "";
  let profileDir = "";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-profile-edit-"));
    profileDir = path.join(tmp, ".sm");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "mesh.config.yaml"), MINIMAL_CONFIG);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("adds an Nth manager column with no role yaml or seats.dirs entry required", () => {
    const loaded = loadProfile(profileDir);
    const result = addBaseColumn(loaded, "manager-2", { cli: "claude" });
    expect(result.columns).toEqual(["manager", "secretary", "manager-2"]);

    const reloaded = loadProfile(profileDir);
    expect(reloaded.profile.layout?.base.columns).toEqual(["manager", "secretary", "manager-2"]);
    expect(reloaded.profile.layout?.base.cli?.["manager-2"]).toBe("claude");
    // no seats.dirs entry was written -- seatDirSegment falls back to the id itself
    expect(reloaded.profile.seats.dirs?.["manager-2"]).toBeUndefined();
  });

  it("preserves comments and inserts --after a given column", () => {
    const loaded = loadProfile(profileDir);
    addBaseColumn(loaded, "manager-2", { after: "manager" });
    const raw = fs.readFileSync(path.join(profileDir, "mesh.config.yaml"), "utf8");
    expect(raw).toContain("# fixture profile");
    expect(listBaseColumns(loaded)).toEqual(["manager", "manager-2", "secretary"]);
  });

  it("marks a column human-co-typed", () => {
    const loaded = loadProfile(profileDir);
    addBaseColumn(loaded, "manager-2", { coTyped: true });
    const reloaded = loadProfile(profileDir);
    expect(reloaded.profile.layout?.base.humanCoTyped).toEqual(["manager-2"]);
  });

  it("rejects a duplicate column id", () => {
    const loaded = loadProfile(profileDir);
    expect(() => addBaseColumn(loaded, "manager")).toThrow(/already exists/);
  });

  it("rejects a bad column id", () => {
    const loaded = loadProfile(profileDir);
    expect(() => addBaseColumn(loaded, "Manager_2!")).toThrow(/bad column id/);
  });

  it("removes a column and its cli/humanCoTyped/seats.dirs entries", () => {
    const loaded = loadProfile(profileDir);
    addBaseColumn(loaded, "manager-2", { cli: "claude", coTyped: true });
    const removed = removeBaseColumn(loadProfile(profileDir), "manager-2");
    expect(removed.columns).toEqual(["manager", "secretary"]);
    const reloaded = loadProfile(profileDir);
    expect(reloaded.profile.layout?.base.cli?.["manager-2"]).toBeUndefined();
    expect(reloaded.profile.layout?.base.humanCoTyped ?? []).not.toContain("manager-2");
  });

  it("refuses to remove the last base column", () => {
    const loaded = loadProfile(profileDir);
    removeBaseColumn(loaded, "secretary");
    expect(() => removeBaseColumn(loadProfile(profileDir), "manager")).toThrow(
      /cannot remove the last/,
    );
  });

  it("supports 100+ manager columns (no per-instance code, just config)", () => {
    let loaded = loadProfile(profileDir);
    for (let n = 2; n <= 101; n++) {
      addBaseColumn(loaded, `manager-${n}`);
      loaded = loadProfile(profileDir);
    }
    const cols = listBaseColumns(loaded);
    expect(cols.length).toBe(102); // manager, secretary, manager-2..manager-101
    expect(cols).toContain("manager-101");
    expect(loaded.profile.layout?.base.columns.length).toBe(102);
  });
});

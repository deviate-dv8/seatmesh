import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProfile } from "@seat-mesh/core";
import { mergeMeshConfigOnUpdate } from "./merge-mesh-config.js";

const LEGACY_CONFIG = `# fixture — pre-1.1.5 (missing co-typed + logs window)
name: legacy
workspace: ..

session:
  name: mesh
  workerCount: 1
  miniMax: 1

layout:
  base:
    window: base
    columns: [manager, secretary]
    cli:
      manager: agent
      secretary: opencode

seats:
  root: seats
  templates: [FOCUS, TASKS, REMINDER]

state:
  agentsJson: agents.json
  meshAgentsJson: mesh-agents.json

daemon:
  port: 31998
  managerPromptPrefix: "[mgr]"

ports:
  worker: "30{n}0/30{n}1"

providers:
  - cursor-agent

roles:
  dir: roles
`;

describe("mergeMeshConfigOnUpdate", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("adds humanCoTyped + logs + todos + policy keys once and does not overwrite", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-merge-"));
    const sm = path.join(tmp, ".sm");
    fs.mkdirSync(sm, { recursive: true });
    const cfg = path.join(sm, "mesh.config.yaml");
    fs.writeFileSync(cfg, LEGACY_CONFIG);

    const loaded = loadProfile(sm);
    const first = mergeMeshConfigOnUpdate(loaded, false);
    expect(first.added).toEqual([
      "layout.base.humanCoTyped",
      "layout.logs",
      "todos",
      "chatRooms.checkback.maxFires",
      "chatRooms.thinNotify",
      "ppa",
      "acks",
      "targets",
    ]);
    expect(first.wrote).toBe(true);

    const body = fs.readFileSync(cfg, "utf8");
    expect(body).toMatch(/humanCoTyped:/);
    expect(body).toMatch(/added by seatmesh update/);
    expect(body).toMatch(/logs:/);
    expect(body).toMatch(/window:\s*logs/);
    expect(body).toMatch(/todos:/);
    expect(body).toMatch(/reportTo:\s*manager/);
    expect(body).toMatch(/idleSlackSec:\s*120/);
    expect(body).toMatch(/triageTo:/);
    expect(body).toMatch(/maxFires:\s*3/);

    const second = mergeMeshConfigOnUpdate(loadProfile(sm), false);
    expect(second.added).toEqual([]);
    expect(second.wrote).toBe(false);
  });

  it("dry-run reports keys without writing", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-merge-dry-"));
    const sm = path.join(tmp, ".sm");
    fs.mkdirSync(sm, { recursive: true });
    const cfg = path.join(sm, "mesh.config.yaml");
    fs.writeFileSync(cfg, LEGACY_CONFIG);
    const r = mergeMeshConfigOnUpdate(loadProfile(sm), true);
    expect(r.added).toContain("layout.base.humanCoTyped");
    expect(r.wrote).toBe(false);
    expect(fs.readFileSync(cfg, "utf8")).not.toMatch(/^\s*humanCoTyped:/m);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkMeshConfig } from "./config-check.js";

const tmpDirs: string[] = [];

function mkProfile(yaml: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sm-config-check-"));
  tmpDirs.push(root);
  const sm = path.join(root, ".sm");
  fs.mkdirSync(sm, { recursive: true });
  fs.mkdirSync(path.join(sm, "roles"), { recursive: true });
  fs.writeFileSync(path.join(sm, "mesh.config.yaml"), yaml);
  return sm;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("checkMeshConfig", () => {
  it("passes a minimal valid profile", () => {
    const sm = mkProfile(`name: test
workspace: ..
session:
  name: mesh
  workerCount: 1
  miniMax: 1
seats:
  root: seats
  templates: [FOCUS]
state:
  agentsJson: tmux-main-agents.json
roles:
  dir: roles
daemon:
  port: 31670
  portScope: profile
ports:
  worker: "30{n}0/30{n}1"
`);
    const r = checkMeshConfig(sm);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("fails on schema errors", () => {
    const sm = mkProfile(`name: test
workspace: ..
session:
  workerCount: not-a-number
`);
    const r = checkMeshConfig(sm);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id.startsWith("schema-"))).toBe(true);
  });

  it("fails on YAML syntax errors", () => {
    const sm = mkProfile("name: test\n  seats: [unclosed");
    const r = checkMeshConfig(sm);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.id).toBe("yaml-syntax");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedProfile, MeshAgents } from "@seat-mesh/core";
import { MeshAgentsSchema } from "@seat-mesh/core";
import { assertSaveAllowed, formatSaveSummary, saveMeshAgentsFile } from "./save-session.js";

function sampleAgents(): MeshAgents {
  return {
    schemaVersion: 1,
    session: "mesh-abc",
    workdir: "/tmp/ws",
    manager: { type: "agent", resumeId: "mgr-1" },
    manager2: { type: "claude", resumeId: "mgr2-1" },
    secretary: { type: "opencode", wanted: true, resumeId: "ses_sec" },
    workers: [
      { slot: 1, type: "agent", resumeId: "w1" },
      { slot: 2, type: "empty", resumeId: null },
    ],
    minis: [{ mini: 1, type: "opencode", role: "tester", resumeId: "m1" }],
    layout: { minis: { enabled: true, grid: "4x2", max: 8, leads: [1, 2] } },
    conventions: {
      secretaryDefaultCli: "opencode",
      miniDefaultCli: "opencode",
      launchSkipsEmpty: true,
    },
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

describe("formatSaveSummary", () => {
  it("prints harness-style slot summary", () => {
    const out = formatSaveSummary(sampleAgents(), "/tmp/ws/.sm/mesh-agents.json");
    expect(out).toContain("--- summary ---");
    expect(out).toContain("session: mesh-abc");
    expect(out).toContain("manager: agent resume");
    expect(out).toContain("manager-2: claude resume");
    expect(out).toContain("secretary: wanted=true type=opencode resume");
    expect(out).toContain("slot 1: agent resume");
    expect(out).toContain("slot 2: empty");
    expect(out).toContain("mini 1: opencode role=tester resume");
    expect(out).toContain("layout.minis: 4x2 max=8 leads=[1,2]");
    expect(out).toContain("full JSON: /tmp/ws/.sm/mesh-agents.json");
  });
});

describe("assertSaveAllowed", () => {
  it("allows outside tmux", () => {
    const prev = process.env.TMUX_PANE;
    delete process.env.TMUX_PANE;
    const loaded = {
      sessionName: "mesh-x",
      workspace: "/tmp",
      profile: { layout: { minis: { window: "minis" } } },
    } as LoadedProfile;
    expect(() => assertSaveAllowed(loaded)).not.toThrow();
    if (prev) process.env.TMUX_PANE = prev;
  });
});

describe("saveMeshAgentsFile", () => {
  it("writes atomically and round-trips manager-2", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-agents-"));
    const rel = "mesh-agents.json";
    const file = saveMeshAgentsFile(dir, rel, sampleAgents());
    expect(fs.existsSync(file)).toBe(true);
    const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    const parsed = MeshAgentsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(parsed.manager2?.type).toBe("claude");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

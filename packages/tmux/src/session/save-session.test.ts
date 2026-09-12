import { describe, expect, it } from "vitest";
import type { LoadedProfile, MeshAgents } from "@seat-mesh/core";
import { assertSaveAllowed, formatSaveSummary } from "./save-session.js";

function sampleAgents(): MeshAgents {
  return {
    schemaVersion: 1,
    session: "mesh-abc",
    workdir: "/tmp/ws",
    manager: { type: "agent", resumeId: "mgr-1" },
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

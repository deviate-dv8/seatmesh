import { describe, expect, it } from "vitest";
import type { LoadedProfile, MeshAgents } from "@seat-mesh/core";
import { patchMeshAgentsForPane, ensureMeshAgentsRecord } from "./set-tag.js";
import type { PaneRow } from "../lib/resolve-pane.js";

const loaded = {
  sessionName: "mesh",
  workspace: "/tmp/ws",
  profile: {
    name: "zsign",
    ports: { worker: "30{n}0/30{n}1" },
    state: { meshAgentsJson: ".sm/mesh-agents.json" },
  },
} as unknown as LoadedProfile;

const baseMesh: MeshAgents = {
  schemaVersion: 1,
  session: "mesh",
  workdir: "/tmp/ws",
  coords: undefined,
  workers: [],
  minis: [],
  conventions: {
    secretaryDefaultCli: "opencode",
    miniDefaultCli: "opencode",
    launchSkipsEmpty: true,
  },
};

describe("patchMeshAgentsForPane", () => {
  it("upserts worker slot with resume cmd", () => {
    const row: PaneRow = {
      paneId: "%1",
      session: "mesh",
      window: "workers",
      role: "worker",
      slot: "3",
      ports: "3030/3031",
      mini: "",
      workspaceId: "zsign",
    };
    const next = patchMeshAgentsForPane(baseMesh, row, loaded, {
      type: "agent",
      resumeId: "abc-123",
    });
    expect(next.workers).toHaveLength(1);
    expect(next.workers[0]).toMatchObject({
      slot: 3,
      type: "agent",
      resumeId: "abc-123",
      ports: "3030/3031",
    });
    expect(next.workers[0]?.resumeCmd).toContain("--resume abc-123");
  });

  it("set manager clears resume id", () => {
    const row: PaneRow = {
      paneId: "%2",
      session: "mesh",
      window: "base",
      role: "manager",
      slot: "manager",
      ports: "manager",
      mini: "",
      workspaceId: "zsign",
    };
    const withMgr = {
      ...baseMesh,
      manager: {
        type: "agent" as const,
        name: "manager",
        resumeId: "old",
        resumeCmd: "agent --resume old",
      },
    };
    const next = patchMeshAgentsForPane(withMgr, row, loaded, {
      type: "claude",
      resumeId: null,
    });
    expect(next.manager).toMatchObject({
      type: "claude",
      resumeId: null,
      resumeCmd: expect.stringContaining("claude"),
    });
  });

  it("ensureMeshAgentsRecord seeds skeleton", () => {
    const rec = ensureMeshAgentsRecord(loaded);
    expect(rec.schemaVersion).toBe(1);
    expect(rec.session).toBe("mesh");
    expect(rec.workers).toEqual([]);
  });
});

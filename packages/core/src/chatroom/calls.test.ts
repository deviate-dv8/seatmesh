import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MeshProfileSchema } from "../schema/profile.js";
import {
  resolveSessionName,
  workspaceScopeId,
  type LoadedProfile,
} from "../profile/profile.js";
import {
  callsPath,
  createPendingCall,
  findCallByShortId,
  updateCall,
} from "./calls.js";
import { peerRoomSlugAgents } from "../comms/call-target.js";

function testLoaded(workspace: string): LoadedProfile {
  const profile = MeshProfileSchema.parse({
    name: "test",
    workspace: ".",
    session: { name: "mesh" },
    seats: { root: "tasks/agent-seats" },
    state: { meshAgentsJson: "mesh-agents.json" },
    roles: { dir: "roles" },
  });
  return {
    profile,
    profileDir: workspace,
    profilePath: path.join(workspace, ".sm/mesh.config.yaml"),
    workspace,
    workspaceId: workspaceScopeId(workspace),
    sessionName: resolveSessionName(profile, workspace),
  };
}

describe("room calls", () => {
  let workspace = "";

  afterEach(() => {
    if (workspace && fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("creates pending call with stable peer slug", () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-calls-"));
    const loaded = testLoaded(workspace);

    const row = createPendingCall(loaded, {
      fromAgent: "worker-3",
      toAgent: "worker-6",
      fromSlot: "3",
      toSlot: "6",
      topic: "debug consoles",
    });
    expect(row.shortId).toHaveLength(8);
    expect(row.roomSlug).toBe(peerRoomSlugAgents("worker-3", "worker-6", row.shortId));
    expect(fs.existsSync(callsPath(loaded))).toBe(true);

    const found = findCallByShortId(loaded, row.shortId);
    expect(found?.status).toBe("pending");

    row.status = "accepted";
    row.resolvedAt = new Date().toISOString();
    updateCall(loaded, row);
    expect(findCallByShortId(loaded, row.shortId)?.status).toBe("accepted");
  });
});

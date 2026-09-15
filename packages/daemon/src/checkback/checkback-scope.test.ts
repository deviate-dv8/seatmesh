import { describe, expect, it, vi } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";
import {
  bindCheckbackOwnerPane,
  paneBelongsToLoadedMesh,
  stampCheckbackScope,
} from "./checkback-scope.js";

vi.mock("@seat-mesh/tmux", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@seat-mesh/tmux")>();
  return {
    ...actual,
    resolveLiveTmuxSession: () => "mesh-abc123",
    resolvePaneTarget: (label: string) => {
      if (label === "mini-1") return { paneId: "%99", row: { paneId: "%99" } };
      return { error: "nope" };
    },
    paneMetaForPane: (paneId: string) =>
      paneId === "%99" ? { paneId, role: "mini", slot: "", mini: "1", ports: "" } : null,
    isLabeledMeshPane: (m: { role?: string } | null) => Boolean(m?.role),
  };
});

vi.mock("node:child_process", () => ({
  spawnSync: (_cmd: string, args: string[]) => {
    const pane = args[args.indexOf("-t") + 1];
    if (pane === "%26") {
      // Foreign mesh (pia)
      return {
        status: 0,
        stdout: "%26\tmesh-867400\t867400\tworker\t4\t\n",
      };
    }
    if (pane === "%43") {
      return {
        status: 0,
        stdout: "%43\tmesh-abc123\tabc123\tmini\t\t1\n",
      };
    }
    if (pane === "%99") {
      return {
        status: 0,
        stdout: "%99\tmesh-abc123\tabc123\tmini\t\t1\n",
      };
    }
    return { status: 1, stdout: "" };
  },
}));

const loaded = {
  workspaceId: "abc123",
  sessionName: "mesh-abc123",
  profile: { layout: { base: { columns: ["manager", "secretary"] } } },
} as unknown as LoadedProfile;

describe("checkback-scope", () => {
  it("rejects foreign workspace panes", () => {
    const r = paneBelongsToLoadedMesh(loaded, "%26");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/foreign-workspace/);
  });

  it("accepts panes in this workspace", () => {
    const r = paneBelongsToLoadedMesh(loaded, "%43");
    expect(r.ok).toBe(true);
  });

  it("cancels orphan CB on foreign pane when no retarget label", () => {
    const bound = bindCheckbackOwnerPane(loaded, {
      id: "cb-1",
      kind: "comms",
      status: "active",
      ownerPane: "%26",
      createdAt: "",
      updatedAt: "",
    });
    expect(bound.paneId).toBeNull();
    expect(bound.cancelReason).toMatch(/^orphan:/);
  });

  it("retargets foreign pane via ownerLabel", () => {
    const bound = bindCheckbackOwnerPane(loaded, {
      id: "cb-2",
      kind: "comms",
      status: "active",
      ownerPane: "%26",
      ownerLabel: "mini-1",
      createdAt: "",
      updatedAt: "",
    });
    expect(bound.paneId).toBe("%99");
    expect(bound.rerouted).toBe(true);
  });

  it("stamps workspace on arm", () => {
    const s = stampCheckbackScope(loaded, { ownerPane: "%43", recipientLabel: "mini-1" });
    expect(s.workspaceId).toBe("abc123");
    expect(s.sessionName).toBe("mesh-abc123");
    expect(s.ownerLabel).toBe("mini-1");
  });
});

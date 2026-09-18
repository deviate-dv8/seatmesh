import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core/profile";

const spawnSync = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSync(...args),
}));

vi.mock("./live-session.js", () => ({
  resolveLiveTmuxSession: vi.fn((loaded: LoadedProfile) => loaded.sessionName),
  sessionWorkspaceId: vi.fn((session: string) => {
    if (session === "mesh-c87d62") return "c87d62";
    if (session === "mesh-2a311d") return "2a311d";
    return null;
  }),
  sessionsForWorkspace: vi.fn((wid: string) => {
    if (wid === "c87d62") return ["mesh-c87d62"];
    if (wid === "2a311d") return ["mesh-2a311d"];
    return [];
  }),
}));

vi.mock("./tmux-run.js", () => ({
  tmuxHasSession: vi.fn((s: string) => s.startsWith("mesh-")),
}));

import {
  assertPaneInLiveSession,
  listPanes,
  resolvePaneTarget,
  type PaneRow,
} from "./resolve-pane.js";

function paneLine(
  paneId: string,
  session: string,
  window: string,
  role: string,
  slot: string,
  wid: string,
): string {
  return `${paneId}\t${session}\t${window}\t${role}\t${slot}\t\t\t${wid}`;
}

const seatmesh = {
  sessionName: "mesh-c87d62",
  workspaceId: "c87d62",
  workspace: "/tmp/seatmesh",
  profile: {
    layout: {
      base: { window: "base", columns: ["manager", "secretary"], kinds: {} },
      workers: { window: "workers", slots: 2, grid: "2x1", enabled: true },
      minis: { window: "minis", max: 1, grid: "1x1", enabled: true },
    },
  },
} as unknown as LoadedProfile;

describe("listPanes isolation", () => {
  beforeEach(() => {
    spawnSync.mockReset();
  });

  it("refuses empty session (would be host-wide -a)", () => {
    expect(() => listPanes("")).toThrow(/empty session refused/);
    expect(() => listPanes("  ")).toThrow(/empty session refused/);
  });

  it("scopes list-panes to -s -t session", () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: paneLine("%33", "mesh-c87d62", "workers", "worker", "1", "c87d62") + "\n",
    });
    const rows = listPanes("mesh-c87d62");
    expect(spawnSync.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["list-panes", "-s", "-t", "mesh-c87d62"]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session).toBe("mesh-c87d62");
  });
});

describe("resolvePaneTarget live-session only", () => {
  beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("list-panes") && joined.includes("mesh-c87d62")) {
        return {
          status: 0,
          stdout:
            paneLine("%33", "mesh-c87d62", "workers", "worker", "1", "c87d62") +
            "\n" +
            paneLine("%60", "mesh-c87d62", "workers", "worker", "2", "c87d62") +
            "\n",
        };
      }
      return { status: 1, stdout: "" };
    });
  });

  it("resolves slot-1 inside live session", () => {
    const r = resolvePaneTarget("1", seatmesh);
    expect(r).toMatchObject({ paneId: "%33" });
    if ("error" in r) throw new Error(r.error);
    expect(r.row.session).toBe("mesh-c87d62");
  });

  it("does not fall through to foreign session slot-1", () => {
    // Live has no slot-3; foreign mesh would have had one — must error, not bleed.
    const r = resolvePaneTarget("3", seatmesh);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/slot 3 pane not found/);
  });

  it("refuses foreign %id", () => {
    const r = resolvePaneTarget("%2", seatmesh);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/not in workspace_id=c87d62/);
  });
});

describe("assertPaneInLiveSession", () => {
  it("throws when row.session ≠ live", () => {
    const row: PaneRow = {
      paneId: "%2",
      session: "mesh-2a311d",
      window: "workers",
      role: "worker",
      slot: "1",
      ports: "",
      mini: "",
      workspaceId: "2a311d",
    };
    expect(() => assertPaneInLiveSession(row, seatmesh)).toThrow(/not live/);
  });

  it("allows matching live session", () => {
    const row: PaneRow = {
      paneId: "%33",
      session: "mesh-c87d62",
      window: "workers",
      role: "worker",
      slot: "1",
      ports: "",
      mini: "",
      workspaceId: "c87d62",
    };
    expect(() => assertPaneInLiveSession(row, seatmesh)).not.toThrow();
  });
});

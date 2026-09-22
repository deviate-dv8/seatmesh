import { describe, expect, it, vi } from "vitest";
import type { PaneSnapshot, ProviderRegistry } from "@seat-mesh/core";

const listSessionPanesMock = vi.fn();
const capturePaneSnapshotMock = vi.fn();
vi.mock("../lib/snapshot.js", () => ({
  listSessionPanes: (...args: unknown[]) => listSessionPanesMock(...args),
  capturePaneSnapshot: (...args: unknown[]) => capturePaneSnapshotMock(...args),
}));

const { scanSessionPanes } = await import("./pane-scan.js");

function snap(paneId: string, options: Record<string, string> = {}): PaneSnapshot {
  return {
    paneId,
    windowName: "base",
    cwd: "/tmp",
    currentCommand: "node",
    captureTail: "",
    options,
  };
}

describe("scanSessionPanes", () => {
  it("returns one row per pane with a detected provider", () => {
    listSessionPanesMock.mockReturnValue(["%0", "%1"]);
    capturePaneSnapshotMock.mockImplementation((paneId: string) =>
      snap(paneId, { mesh_role: "worker", mesh_slot: "1", mesh_ports: "3010/3011" }),
    );
    const prov = {
      id: "opencode",
      detect: () => ({ providerId: "opencode", resumeId: "ses_abc" }),
      composerState: () => ({ phase: "busy" as const }),
    };
    const reg = { detect: () => prov } as unknown as ProviderRegistry;

    const rows = scanSessionPanes(reg, "mesh-test");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      paneId: "%0",
      role: "worker",
      providerId: "opencode",
      resumeId: "ses_abc",
      phase: "busy",
      slot: "1",
      ports: "3010/3011",
      window: "base",
    });
  });

  it("skips panes whose snapshot capture fails (null)", () => {
    listSessionPanesMock.mockReturnValue(["%0", "%1"]);
    capturePaneSnapshotMock.mockImplementation((paneId: string) =>
      paneId === "%0" ? null : snap(paneId),
    );
    const reg = { detect: () => null } as unknown as ProviderRegistry;
    const rows = scanSessionPanes(reg, "mesh-test");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.paneId).toBe("%1");
  });

  it("defaults role to 'plain' and providerId/resumeId to null when nothing detects", () => {
    listSessionPanesMock.mockReturnValue(["%0"]);
    capturePaneSnapshotMock.mockReturnValue(snap("%0"));
    const reg = { detect: () => null } as unknown as ProviderRegistry;
    const rows = scanSessionPanes(reg, "mesh-test");
    expect(rows[0]).toMatchObject({
      role: "plain",
      providerId: null,
      resumeId: null,
      phase: "plain_shell",
      slot: "-",
      ports: "-",
    });
  });

  it("carries limitKind through when the composer reports one", () => {
    listSessionPanesMock.mockReturnValue(["%0"]);
    capturePaneSnapshotMock.mockReturnValue(snap("%0"));
    const prov = {
      id: "claude",
      detect: () => ({ providerId: "claude" }),
      composerState: () => ({ phase: "limit" as const, limitKind: "cc-limit" }),
    };
    const reg = { detect: () => prov } as unknown as ProviderRegistry;
    const rows = scanSessionPanes(reg, "mesh-test");
    expect(rows[0]?.phase).toBe("limit");
    expect(rows[0]?.limitKind).toBe("cc-limit");
  });

  it("returns [] for an empty session (no panes)", () => {
    listSessionPanesMock.mockReturnValue([]);
    const reg = { detect: () => null } as unknown as ProviderRegistry;
    expect(scanSessionPanes(reg, "mesh-empty")).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PaneScanRow } from "@seat-mesh/tmux";
import type { SessionRow } from "./sessions-cli.js";

const listSessionRowsMock = vi.fn();
vi.mock("./sessions-cli.js", () => ({
  listSessionRows: (...args: unknown[]) => listSessionRowsMock(...args),
}));

const loadProfileMock = vi.fn();
vi.mock("@seat-mesh/core", () => ({
  loadProfile: (...args: unknown[]) => loadProfileMock(...args),
}));

const createRegistryForProfileMock = vi.fn();
vi.mock("@seat-mesh/providers", () => ({
  createRegistryForProfile: (...args: unknown[]) => createRegistryForProfileMock(...args),
}));

const scanSessionPanesMock = vi.fn();
vi.mock("@seat-mesh/tmux", () => ({
  scanSessionPanes: (...args: unknown[]) => scanSessionPanesMock(...args),
}));

const { buildSidebarView, renderSidebar } = await import("./sidebar-cli.js");

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "abc123",
    label: "myproj",
    profilePath: "/work/myproj/.sm/mesh.config.yaml",
    workspace: "/work/myproj",
    workspaceId: "abc123",
    sessionName: "mesh-abc123",
    daemonPort: 31680,
    lastSeen: "2026-01-01T00:00:00.000Z",
    tmuxLive: true,
    ...overrides,
  } as SessionRow;
}

function paneRow(overrides: Partial<PaneScanRow> = {}): PaneScanRow {
  return {
    paneId: "%0",
    role: "worker",
    providerId: "opencode",
    resumeId: null,
    phase: "empty",
    limitKind: null,
    slot: "1",
    ports: "3010/3011",
    window: "base",
    ...overrides,
  };
}

describe("buildSidebarView", () => {
  it("skips pane scanning for a stopped (non-tmux-live) session", () => {
    listSessionRowsMock.mockReturnValue([row({ tmuxLive: false })]);
    const views = buildSidebarView();
    expect(views).toHaveLength(1);
    expect(views[0]?.panes).toBeNull();
    expect(loadProfileMock).not.toHaveBeenCalled();
  });

  it("scans panes for a live session", () => {
    listSessionRowsMock.mockReturnValue([row({ tmuxLive: true })]);
    loadProfileMock.mockReturnValue({ profile: {} });
    createRegistryForProfileMock.mockReturnValue({});
    scanSessionPanesMock.mockReturnValue([paneRow()]);
    const views = buildSidebarView();
    expect(views[0]?.panes).toEqual([paneRow()]);
    expect(scanSessionPanesMock).toHaveBeenCalledWith({}, "mesh-abc123");
  });

  it("falls back to panes: null when loading the profile throws (never crashes the whole view)", () => {
    listSessionRowsMock.mockReturnValue([row({ tmuxLive: true })]);
    loadProfileMock.mockImplementation(() => {
      throw new Error("profile gone");
    });
    const views = buildSidebarView();
    expect(views[0]?.panes).toBeNull();
  });

  it("handles multiple sessions independently", () => {
    listSessionRowsMock.mockReturnValue([
      row({ id: "a", tmuxLive: false }),
      row({ id: "b", tmuxLive: true, sessionName: "mesh-b" }),
    ]);
    loadProfileMock.mockReturnValue({ profile: {} });
    createRegistryForProfileMock.mockReturnValue({});
    scanSessionPanesMock.mockReturnValue([]);
    const views = buildSidebarView();
    expect(views).toHaveLength(2);
    expect(views[0]?.panes).toBeNull();
    expect(views[1]?.panes).toEqual([]);
  });
});

describe("renderSidebar", () => {
  const at = new Date("2026-01-01T00:00:00.000Z");

  it("shows an empty-state message with zero registered sessions", () => {
    const out = renderSidebar([], at);
    expect(out).toContain("0 registered session");
    expect(out).toContain("no registered sessions");
  });

  it("shows a live session's panes indented under it", () => {
    const out = renderSidebar(
      [{ row: row({ label: "myproj", tmuxLive: true }), panes: [paneRow({ role: "worker", providerId: "opencode" })] }],
      at,
    );
    expect(out).toContain("myproj");
    expect(out).toContain("live");
    expect(out).toContain("worker");
    expect(out).toContain("opencode");
  });

  it("shows a stopped session with no pane detail", () => {
    const out = renderSidebar([{ row: row({ label: "myproj", tmuxLive: false }), panes: null }], at);
    expect(out).toContain("stopped");
    expect(out).not.toContain("(no panes detected)");
  });

  it("shows a placeholder when a live session has zero panes", () => {
    const out = renderSidebar([{ row: row({ tmuxLive: true }), panes: [] }], at);
    expect(out).toContain("(no panes detected)");
  });

  it("includes limitKind in the pane status when present", () => {
    const out = renderSidebar(
      [{ row: row({ tmuxLive: true }), panes: [paneRow({ phase: "limit", limitKind: "cc-limit" })] }],
      at,
    );
    expect(out).toContain("limit:cc-limit");
  });
});

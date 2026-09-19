import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LoadedProfile, PaneSnapshot } from "@seat-mesh/core";

const resolvePaneTargetMock = vi.fn();
vi.mock("../lib/resolve-pane.js", () => ({
  resolvePaneTarget: (...args: unknown[]) => resolvePaneTargetMock(...args),
}));

const capturePaneSnapshotMock = vi.fn();
vi.mock("../lib/snapshot.js", () => ({
  capturePaneSnapshot: (...args: unknown[]) => capturePaneSnapshotMock(...args),
}));

const spawnSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const { runPaneCapture } = await import("./pane-capture-cli.js");

const loaded = {} as LoadedProfile;

function snap(captureTail: string, captureTailAnsi?: string): PaneSnapshot {
  return {
    paneId: "%1",
    windowName: "workers",
    cwd: "/tmp",
    currentCommand: "node",
    captureTail,
    captureTailAnsi,
    options: {},
  };
}

describe("runPaneCapture", () => {
  beforeEach(() => {
    resolvePaneTargetMock.mockReset();
    capturePaneSnapshotMock.mockReset();
    spawnSyncMock.mockReset();
    resolvePaneTargetMock.mockReturnValue({
      paneId: "%1",
      row: { paneId: "%1", session: "s", window: "w", role: "worker", slot: "1", ports: "-", mini: "-", workspaceId: "w" },
    });
  });

  it("throws the resolver's error when target can't be resolved", () => {
    resolvePaneTargetMock.mockReturnValue({ error: "not in tmux" });
    expect(() => runPaneCapture(loaded, [])).toThrow("not in tmux");
  });

  it("prints captureTail from the snapshot by default", () => {
    capturePaneSnapshotMock.mockReturnValue(snap("line one\nline two"));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    runPaneCapture(loaded, ["here"]);
    spy.mockRestore();
    expect(logs).toEqual(["line one\nline two"]);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("uses captureTailAnsi when --ansi is passed", () => {
    capturePaneSnapshotMock.mockReturnValue(snap("plain", "\x1b[31mred\x1b[0m"));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    runPaneCapture(loaded, ["here", "--ansi"]);
    spy.mockRestore();
    expect(logs).toEqual(["\x1b[31mred\x1b[0m"]);
  });

  it("wraps output as JSON lines when --json is passed", () => {
    capturePaneSnapshotMock.mockReturnValue(snap("a\nb\nc"));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    runPaneCapture(loaded, ["here", "--json"]);
    spy.mockRestore();
    const parsed = JSON.parse(logs[0]);
    expect(parsed).toEqual({ paneId: "%1", lines: ["a", "b", "c"] });
  });

  it("calls raw tmux capture-pane with -S -N when --lines is passed", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "raw output\n" });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    runPaneCapture(loaded, ["here", "--lines", "200"]);
    spy.mockRestore();
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "tmux",
      ["capture-pane", "-t", "%1", "-p", "-S", "-200"],
      expect.anything(),
    );
    expect(capturePaneSnapshotMock).not.toHaveBeenCalled();
    expect(logs).toEqual(["raw output"]);
  });

  it("rejects a non-positive --lines value", () => {
    expect(() => runPaneCapture(loaded, ["here", "--lines", "0"])).toThrow(/positive integer/);
    expect(() => runPaneCapture(loaded, ["here", "--lines", "nope"])).toThrow(/positive integer/);
  });

  it("defaults target to 'here' when none given", () => {
    capturePaneSnapshotMock.mockReturnValue(snap("x"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    runPaneCapture(loaded, []);
    expect(resolvePaneTargetMock).toHaveBeenCalledWith("here", loaded);
  });
});

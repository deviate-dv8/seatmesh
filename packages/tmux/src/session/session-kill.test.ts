import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";

const readGlobalRegistryMock = vi.fn();
const findGlobalSessionMock = vi.fn();
const loadProfileMock = vi.fn();
vi.mock("@seat-mesh/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@seat-mesh/core")>();
  return {
    ...actual,
    readGlobalRegistry: (...args: unknown[]) => readGlobalRegistryMock(...args),
    findGlobalSession: (...args: unknown[]) => findGlobalSessionMock(...args),
    loadProfile: (...args: unknown[]) => loadProfileMock(...args),
  };
});

const tmuxMock = vi.fn();
const tmuxHasSessionMock = vi.fn();
vi.mock("../lib/tmux-run.js", () => ({
  tmux: (...args: unknown[]) => tmuxMock(...args),
  tmuxHasSession: (...args: unknown[]) => tmuxHasSessionMock(...args),
}));

const stopMeshInboxMock = vi.fn();
vi.mock("../comms/inbox-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../comms/inbox-bridge.js")>();
  return { ...actual, stopMeshInbox: (...args: unknown[]) => stopMeshInboxMock(...args) };
});

const { killRegisteredSession } = await import("./session.js");

const loaded = { sessionName: "mesh-abc123" } as LoadedProfile;

describe("killRegisteredSession", () => {
  beforeEach(() => {
    readGlobalRegistryMock.mockReset();
    findGlobalSessionMock.mockReset();
    loadProfileMock.mockReset();
    tmuxMock.mockReset();
    tmuxHasSessionMock.mockReset();
    stopMeshInboxMock.mockReset();
  });

  it("resolves the target via the global registry, loads its profile, and kills it", () => {
    findGlobalSessionMock.mockReturnValue({
      id: "abc123",
      label: "myproj",
      profilePath: "/work/myproj/.sm/mesh.config.yaml",
      sessionName: "mesh-abc123",
    });
    loadProfileMock.mockReturnValue(loaded);
    tmuxHasSessionMock.mockReturnValue(true);
    tmuxMock.mockReturnValue({ ok: true, out: "" });
    stopMeshInboxMock.mockImplementation(() => {});

    const r = killRegisteredSession("myproj");

    expect(loadProfileMock).toHaveBeenCalledWith("/work/myproj/.sm/mesh.config.yaml");
    expect(tmuxMock).toHaveBeenCalledWith(["kill-session", "-t", "mesh-abc123"]);
    expect(r).toEqual({
      sessionKilled: true,
      inboxStopped: true,
      label: "myproj",
      sessionName: "mesh-abc123",
    });
  });

  it("throws a clear error when no registered session matches the target", () => {
    findGlobalSessionMock.mockReturnValue(undefined);
    expect(() => killRegisteredSession("nope")).toThrow(/no registered session matches "nope"/);
    expect(loadProfileMock).not.toHaveBeenCalled();
  });

  it("passes keepInbox through to skip stopping the daemon", () => {
    findGlobalSessionMock.mockReturnValue({
      id: "abc123",
      label: "myproj",
      profilePath: "/work/myproj/.sm/mesh.config.yaml",
      sessionName: "mesh-abc123",
    });
    loadProfileMock.mockReturnValue(loaded);
    tmuxHasSessionMock.mockReturnValue(true);
    tmuxMock.mockReturnValue({ ok: true, out: "" });
    stopMeshInboxMock.mockClear();

    const r = killRegisteredSession("myproj", { keepInbox: true });
    expect(stopMeshInboxMock).not.toHaveBeenCalled();
    expect(r.inboxStopped).toBe(false);
  });

  it("still reports sessionKilled=false when tmux already has no such session", () => {
    findGlobalSessionMock.mockReturnValue({
      id: "abc123",
      label: "myproj",
      profilePath: "/work/myproj/.sm/mesh.config.yaml",
      sessionName: "mesh-abc123",
    });
    loadProfileMock.mockReturnValue(loaded);
    tmuxHasSessionMock.mockReturnValue(false);
    stopMeshInboxMock.mockImplementation(() => {});

    const r = killRegisteredSession("myproj");
    expect(r.sessionKilled).toBe(false);
    expect(tmuxMock).not.toHaveBeenCalled();
  });
});

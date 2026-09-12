import type { LoadedProfile, PaneSnapshot } from "seat-mesh-core";
import { createBuiltinRegistry } from "seat-mesh-providers";
import { describe, expect, it } from "vitest";
import {
  coordSyncDisruptLiveOnReload,
  coordSyncEnabledOnAttach,
  paneNeedsProfileCliFromSnap,
  shouldLaunchCoordPane,
} from "./coord-cli-sync.js";

function snap(partial: Partial<PaneSnapshot> & Pick<PaneSnapshot, "paneId">): PaneSnapshot {
  return {
    windowName: "base",
    cwd: "/tmp",
    currentCommand: "",
    captureTail: "",
    options: {},
    ...partial,
  };
}

function loadedProfile(coordSync?: { reload: boolean; attach: boolean }): LoadedProfile {
  return {
    workspace: "/tmp/workspace",
    profile: {
      name: "minimal",
      workspace: "/tmp/workspace",
      session: { name: "mesh", workerCount: 6, miniMax: 8 },
      layout: {
        base: {
          window: "base",
          columns: ["manager", "secretary"],
          coordSync: coordSync ?? { reload: false, attach: true },
        },
      },
      state: { agentsJson: "tmux-main-agents.json", meshAgentsJson: "mesh-agents.json" },
    },
  } as LoadedProfile;
}

describe("coordSync JSON policy", () => {
  it("reload=false means do not disrupt live CLIs (not skip empty repair)", () => {
    expect(coordSyncDisruptLiveOnReload(loadedProfile(), undefined)).toBe(false);
  });

  it("attach defaults true", () => {
    expect(coordSyncEnabledOnAttach(loadedProfile(), undefined)).toBe(true);
  });
});

describe("shouldLaunchCoordPane", () => {
  const registry = createBuiltinRegistry();

  it("reload starts empty zsh when disruptLiveOnReload is false", () => {
    const pane = snap({
      paneId: "%mb",
      captureTail: "",
      options: { processCmdlines: "zsh" },
      currentCommand: "zsh",
    });
    expect(shouldLaunchCoordPane(registry, pane, "opencode", "reload", false)).toBe(true);
  });

  it("reload does not replace live opencode when disruptLiveOnReload is false", () => {
    const pane = snap({
      paneId: "%mb",
      captureTail: "ctrl+p commands · OpenCode 1.18",
      options: { processCmdlines: "opencode --auto\0zsh" },
    });
    expect(shouldLaunchCoordPane(registry, pane, "opencode", "reload", false)).toBe(false);
  });

  it("reload does not replace live opencode while typing", () => {
    const pane = snap({
      paneId: "%mb",
      captureTail: "some draft text\nctrl+p commands · OpenCode",
      options: { processCmdlines: "opencode --auto\0zsh", mesh_oc_session: "ses_abc" },
    });
    expect(shouldLaunchCoordPane(registry, pane, "opencode", "reload", false)).toBe(false);
  });
});

describe("paneNeedsProfileCliFromSnap", () => {
  const registry = createBuiltinRegistry();

  it("does not relaunch live opencode when capture tail is empty", () => {
    const pane = snap({
      paneId: "%mb",
      captureTail: "",
      options: { processCmdlines: "opencode --auto\0zsh" },
    });
    expect(paneNeedsProfileCliFromSnap(registry, pane, "opencode")).toBe(false);
  });

  it("relaunches plain zsh when profile expects opencode", () => {
    const pane = snap({
      paneId: "%mb",
      captureTail: "",
      options: { processCmdlines: "zsh" },
      currentCommand: "zsh",
    });
    expect(paneNeedsProfileCliFromSnap(registry, pane, "opencode")).toBe(true);
  });
});

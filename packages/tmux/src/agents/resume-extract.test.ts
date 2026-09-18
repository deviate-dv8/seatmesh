import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach, vi } from "vitest";
import type { PaneSnapshot, ProviderRegistry } from "@seat-mesh/core";

// extractResumeIdAuto gates on a live tmux pane snapshot — stub it so the "resume id
// comes from provider detect" path doesn't depend on a real tmux pane %1 existing.
vi.mock("../lib/snapshot.js", () => ({
  capturePaneSnapshot: (paneId: string): PaneSnapshot | null =>
    paneId === "%1"
      ? {
          paneId,
          windowName: "workers",
          cwd: "/tmp",
          currentCommand: "cursor-agent",
          captureTail: "",
          options: {},
        }
      : null,
}));

import { extractResumeIdAuto } from "./resume-extract.js";

describe("extractResumeIdAuto", () => {
  it("returns null when pane snapshot missing", () => {
    const reg = { detect: () => null } as unknown as ProviderRegistry;
    expect(extractResumeIdAuto("%999999", reg)).toBeNull();
  });
});

describe("extractAgentIdFromLogs (via auto path)", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("is covered by provider detect when cmdline has --resume", () => {
    const reg = {
      detect: () => ({
        id: "cursor-agent",
        detect: () => ({ resumeId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
      }),
    } as unknown as ProviderRegistry;
    expect(extractResumeIdAuto("%1", reg)).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});

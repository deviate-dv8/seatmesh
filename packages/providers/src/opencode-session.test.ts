import { describe, expect, it } from "vitest";
import {
  composerFromCapture,
  extractOpenCodeSession,
  formatOpenCodeResumeCommand,
  isOpenCodeSessionId,
  normalizeOpenCodeSessionId,
  resolveOpenCodeSessionForPane,
  scrapeOpenCodeSessionFromCapture,
} from "./shared.js";
import type { PaneSnapshot } from "seat-mesh-core";

describe("extractOpenCodeSession", () => {
  it("reads --session from cmdline", () => {
    expect(
      extractOpenCodeSession(
        "opencode --auto --session ses_f6b3245b0ffe92gpOAVSl31ObU",
      ),
    ).toBe("ses_f6b3245b0ffe92gpOAVSl31ObU");
  });

  it("reads -s from cmdline", () => {
    expect(extractOpenCodeSession("opencode -s ses_abc123xyz")).toBe("ses_abc123xyz");
  });
});

describe("scrapeOpenCodeSessionFromCapture", () => {
  it("returns last ses_ id in scrollback tail", () => {
    const tail = `foo bar
Resumed session ses_old111
still working ses_new222 done`;
    expect(scrapeOpenCodeSessionFromCapture(tail)).toBe("ses_new222");
  });
});

describe("normalizeOpenCodeSessionId", () => {
  it("accepts ses_* only", () => {
    expect(isOpenCodeSessionId("ses_abc123")).toBe(true);
    expect(normalizeOpenCodeSessionId("ses_abc123")).toBe("ses_abc123");
    expect(normalizeOpenCodeSessionId("b762de33-349c-415d-8560-d9af15038a73")).toBeUndefined();
    expect(normalizeOpenCodeSessionId("r1789205751")).toBeUndefined();
  });
});

describe("composerFromCapture (OpenCode resume ack)", () => {
  it("live composer wins over stale rate-limit text in scrollback", () => {
    const tail = `Provider rate limit reached — try again later
some old error lines
Build auto · Big Pickle
╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 /tmp/workspace                       91.9K (46%)  ctrl+p commands    · OpenCode 1.18.30`;
    const pane: PaneSnapshot = {
      paneId: "%1",
      windowName: "workers",
      cwd: "/tmp",
      currentCommand: "opencode",
      captureTail: tail,
      options: {},
    };
    expect(composerFromCapture(pane, "opencode").phase).not.toBe("limit");
  });
});

describe("resolveOpenCodeSessionForPane", () => {
  const base: PaneSnapshot = {
    paneId: "%1",
    windowName: "workers",
    cwd: "/tmp",
    currentCommand: "opencode",
    captureTail: "",
    options: {},
  };

  it("prefers @mesh_oc_session", () => {
    const pane: PaneSnapshot = {
      ...base,
      options: { mesh_oc_session: "ses_stored999" },
      captureTail: "ses_scroll888",
    };
    expect(resolveOpenCodeSessionForPane(pane)).toBe("ses_stored999");
    expect(formatOpenCodeResumeCommand(pane)).toBe("resume [ses_stored999]");
  });

  it("rejects Claude UUID in mesh_oc_session", () => {
    const pane: PaneSnapshot = {
      ...base,
      options: { mesh_oc_session: "b762de33-349c-415d-8560-d9af15038a73" },
      captureTail: "",
    };
    expect(resolveOpenCodeSessionForPane(pane)).toBeNull();
    expect(formatOpenCodeResumeCommand(pane)).toBeNull();
  });
});

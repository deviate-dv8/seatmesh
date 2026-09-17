import { describe, expect, it, vi } from "vitest";
import {
  extractOpenCodeSession,
  normalizeOpenCodeSessionId,
  resolveOpenCodeSessionForPane,
} from "@seat-mesh/providers";
import type { PaneSnapshot } from "@seat-mesh/core";

describe("pane resume session autodetection pieces", () => {
  it("prefers cmdline ses_* then mesh_oc_session", () => {
    const pane = {
      captureTail: "old ses_scrollback99",
      options: {
        mesh_oc_session: "ses_stored123",
        processCmdlines: "opencode --session ses_cmdline456 --auto",
      },
      currentCommand: "opencode",
    } as unknown as PaneSnapshot;
    expect(resolveOpenCodeSessionForPane(pane)).toBe("ses_cmdline456");
  });

  it("extracts from CPE resume_cmd", () => {
    const cmd =
      "cd /ws && MESH_OC_WORKSPACE=/ws HTTPS_PROXY=http://127.0.0.1:18887 scripts/opencode-cpe.sh --session ses_abcXYZ";
    expect(normalizeOpenCodeSessionId(extractOpenCodeSession(cmd))).toBe("ses_abcXYZ");
  });

  it("rejects Claude UUID as OpenCode session", () => {
    expect(
      normalizeOpenCodeSessionId("b762de33-349c-415d-8560-d9af15038a73"),
    ).toBeUndefined();
  });
});

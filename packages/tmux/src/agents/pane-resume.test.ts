import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractOpenCodeSession,
  normalizeOpenCodeSessionId,
  resolveOpenCodeSessionForPane,
} from "@seat-mesh/providers";
import type { PaneSnapshot } from "@seat-mesh/core";
import { loadProfile } from "@seat-mesh/core";
import { resolveHarnessType } from "./pane-resume.js";
import type { PaneAgentState } from "./agents-state.js";

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

// TODO 6.4 — pruning isOpenCodeCpeResumeCmd's redundant fallback here relied on
// entryWantsProxyRecovery already covering the same resumeCmd-pattern check.
// Same "stale type field, correct resumeCmd" case that turned up a real
// pre-existing bug in save-session.ts's equivalent (fixed alongside this).
describe("resolveHarnessType (TODO 6.4)", () => {
  const minimalDir = path.resolve(import.meta.dirname, "../../../../profiles/minimal");
  const loaded = loadProfile(minimalDir);

  const CPE_RESUME_CMD =
    "cd /w && env -u NO_COLOR COLORTERM=truecolor 'scripts/opencode-cpe.sh' --session ses_old";

  function saved(overrides: Partial<PaneAgentState>): PaneAgentState {
    return { type: "opencode", ...overrides };
  }

  it("saved.type === opencode-cpe -> opencode-cpe", () => {
    expect(resolveHarnessType(loaded, "slot-1", "opencode", saved({ type: "opencode-cpe" }))).toBe(
      "opencode-cpe",
    );
  });

  it("stale saved.type but a CPE saved.resume_cmd is still detected as opencode-cpe", () => {
    expect(
      resolveHarnessType(
        loaded,
        "slot-1",
        "opencode",
        saved({ type: "opencode", resume_cmd: CPE_RESUME_CMD }),
      ),
    ).toBe("opencode-cpe");
  });

  it("a plain opencode resume_cmd stays opencode (not falsely detected as CPE)", () => {
    expect(
      resolveHarnessType(
        loaded,
        "slot-1",
        "opencode",
        saved({ type: "opencode", resume_cmd: "opencode --auto --session ses_old" }),
      ),
    ).toBe("opencode");
  });

  it("no saved state falls back to the live type / seat default, not CPE", () => {
    expect(resolveHarnessType(loaded, "slot-1", "opencode", null)).not.toBe("opencode-cpe");
  });
});

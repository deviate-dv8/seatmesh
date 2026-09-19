import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProfile } from "@seat-mesh/core";
import { resolveLaunchCmd } from "./agents-state.js";
import type { PaneAgentState } from "./agents-state.js";

// TODO 6.4 — resolveLaunchCmd's dual check
// (kinds && resumeCmdMatchesKindProve(...)) || isOpenCodeCpeResumeCmd(...)
// simplified to kinds ? resumeCmdMatchesKindProve(...) : isOpenCodeCpeResumeCmd(...).
// Every live caller passes `loaded` (so kinds is always resolved), but the
// no-`loaded` fallback path is exercised here too since it's a real branch.
describe("resolveLaunchCmd (TODO 6.4)", () => {
  const minimalDir = path.resolve(import.meta.dirname, "../../../../profiles/minimal");
  const loaded = loadProfile(minimalDir);

  const CPE_RESUME_CMD =
    "cd /w && env -u NO_COLOR COLORTERM=truecolor 'scripts/opencode-cpe.sh' --session ses_old";

  function entry(overrides: Partial<PaneAgentState>): PaneAgentState {
    return { type: "opencode-cpe", ...overrides };
  }

  it("refreshes --session on a CPE wrapper when loaded is passed (kinds available)", () => {
    const cmd = resolveLaunchCmd(
      entry({ resume_cmd: CPE_RESUME_CMD, resume_id: "ses_new" }),
      "/w",
      loaded,
    );
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_new");
    expect(cmd).not.toContain("ses_old");
  });

  it("refreshes --session on a CPE wrapper when loaded is omitted (legacy fallback path)", () => {
    const cmd = resolveLaunchCmd(
      entry({ resume_cmd: CPE_RESUME_CMD, resume_id: "ses_new" }),
      "/w",
      undefined,
    );
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_new");
    expect(cmd).not.toContain("ses_old");
  });

  it("a plain opencode resume_cmd is not treated as a CPE wrapper", () => {
    const cmd = resolveLaunchCmd(
      entry({
        type: "opencode",
        resume_cmd: "opencode --auto --session ses_old",
        resume_id: "ses_new",
      }),
      "/w",
      loaded,
    );
    // Not the CPE refresh path — returns the raw preserved resume_cmd unmodified
    // (no kind/runner rebuild triggered since entryWantsProxyRecovery is false
    // for plain opencode).
    expect(cmd).toBe("opencode --auto --session ses_old");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildKindLaunchCmd,
  normalizeAgentKind,
  runnersFromProfile,
} from "./runners.js";

describe("normalizeAgentKind", () => {
  it("keeps oc-proxy distinct from plain opencode", () => {
    expect(normalizeAgentKind("oc")).toBe("opencode");
    expect(normalizeAgentKind("OC-proxy")).toBe("oc-proxy");
  });
});

describe("buildKindLaunchCmd oc-proxy", () => {
  const ws = "/tmp/pia";

  it("launches CPE wrapper for oc-proxy kind", () => {
    const cmd = buildKindLaunchCmd("oc-proxy", ws, "ses_f6b3245b0ffe92gpOAVSl31ObU", {
      "oc-proxy": "scripts/opencode-cpe.sh",
    });
    expect(cmd).toMatch(/^cd /);
    expect(cmd).not.toMatch(/env .* cd /);
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_f6b3245b0ffe92gpOAVSl31ObU");
  });

  it("plain oc stays bare opencode --auto", () => {
    expect(buildKindLaunchCmd("oc", ws, null, { "oc-proxy": "scripts/opencode-cpe.sh" })).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor opencode --auto",
    );
  });
});

describe("runnersFromProfile", () => {
  it("aliases runners.opencode to oc-proxy", () => {
    const r = runnersFromProfile({
      agents: { runners: { opencode: "scripts/opencode-cpe.sh" } },
    });
    expect(r["oc-proxy"]).toBe("scripts/opencode-cpe.sh");
  });
});

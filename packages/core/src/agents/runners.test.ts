import { describe, expect, it } from "vitest";
import {
  buildKindLaunchCmd,
  normalizeAgentKind,
  runnersFromProfile,
} from "./runners.js";

describe("normalizeAgentKind", () => {
  it("maps legacy oc-proxy id to canonical opencode-cpe", () => {
    expect(normalizeAgentKind("oc")).toBe("opencode");
    expect(normalizeAgentKind("OC-proxy")).toBe("opencode-cpe");
    expect(normalizeAgentKind("opencode-cpe")).toBe("opencode-cpe");
  });
});

describe("buildKindLaunchCmd opencode-cpe", () => {
  const ws = "/tmp/pia";

  it("launches CPE wrapper for opencode-cpe kind", () => {
    const cmd = buildKindLaunchCmd("opencode-cpe", ws, "ses_f6b3245b0ffe92gpOAVSl31ObU", {
      "opencode-cpe": "scripts/opencode-cpe.sh",
    });
    expect(cmd).toMatch(/^cd /);
    expect(cmd).not.toMatch(/env .* cd /);
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_f6b3245b0ffe92gpOAVSl31ObU");
  });

  it("legacy switch id oc-proxy normalizes and launches CPE", () => {
    const cmd = buildKindLaunchCmd("oc-proxy", ws, null, {
      "opencode-cpe": "scripts/opencode-cpe.sh",
    });
    expect(cmd).toContain("opencode-cpe.sh");
  });

  it("plain oc stays bare opencode --auto", () => {
    expect(buildKindLaunchCmd("oc", ws, null, { "opencode-cpe": "scripts/opencode-cpe.sh" })).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor opencode --auto",
    );
  });
});

describe("runnersFromProfile", () => {
  it("aliases runners.opencode onto opencode-cpe", () => {
    const r = runnersFromProfile({
      agents: { runners: { opencode: "scripts/opencode-cpe.sh" } },
    });
    expect(r["opencode-cpe"]).toBe("scripts/opencode-cpe.sh");
  });
});

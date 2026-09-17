import { describe, expect, it } from "vitest";
import {
  knownAgentKindIds,
  launchCmdFromKind,
  resolveAgentKinds,
  type AgentKindDef,
} from "./kinds.js";

const PROVIDER_KINDS: Record<string, AgentKindDef> = {
  opencode: {
    provider: "opencode",
    aliases: ["oc"],
    launch: { builtin: "opencode" },
  },
  "opencode-cpe": {
    extends: "opencode",
    launch: { command: "scripts/opencode-cpe.sh", sessionFlag: "--session" },
    prove: { cmdline: ["opencode-cpe\\.sh"] },
    satisfy: { whenProvider: "opencode", requireProve: true },
    recovery: { onProxyUp: true },
  },
  agent: {
    provider: "cursor-agent",
    aliases: ["cursor"],
    launch: { builtin: "agent" },
  },
  empty: { provider: "empty", launch: null },
};

describe("resolveAgentKinds", () => {
  it("flattens opencode-cpe as extended opencode", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    expect(kinds["opencode-cpe"].provider).toBe("opencode");
    expect(kinds["opencode-cpe"].extends).toBeUndefined();
    expect(kinds["opencode-cpe"].launch).toEqual({
      command: "scripts/opencode-cpe.sh",
      sessionFlag: "--session",
    });
    expect(kinds.opencode.launch).toEqual({ builtin: "opencode" });
  });

  it("profile overlay can replace CPE launch script", () => {
    const kinds = resolveAgentKinds({
      fromProviders: PROVIDER_KINDS,
      fromProfile: {
        "opencode-cpe": { launch: { command: "scripts/my-cpe.sh" } },
      },
    });
    expect(kinds["opencode-cpe"].launch).toEqual({ command: "scripts/my-cpe.sh" });
    expect(kinds["opencode-cpe"].provider).toBe("opencode");
  });

  it("runners shim overlays launch.command", () => {
    const kinds = resolveAgentKinds({
      fromProviders: PROVIDER_KINDS,
      runners: { "opencode-cpe": "scripts/from-runners.sh" },
    });
    expect(kinds["opencode-cpe"].launch).toEqual({ command: "scripts/from-runners.sh" });
  });

  it("aliases resolve via knownAgentKindIds", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    const known = knownAgentKindIds(kinds);
    expect(known.has("oc")).toBe(true);
    expect(known.has("opencode-cpe")).toBe(true);
  });
});

describe("launchCmdFromKind", () => {
  const ws = "/tmp/pia";

  it("launches CPE wrapper for resolved opencode-cpe", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    const cmd = launchCmdFromKind(kinds["opencode-cpe"], ws, "ses_abc");
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_abc");
    expect(cmd).toMatch(/^cd /);
  });

  it("bare opencode stays builtin", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    expect(launchCmdFromKind(kinds.opencode, ws, null)).toBe(
      "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor opencode --auto",
    );
  });
});

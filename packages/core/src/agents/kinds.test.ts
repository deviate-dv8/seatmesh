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
  "oc-proxy": {
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
  it("flattens oc-proxy as extended opencode", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    expect(kinds["oc-proxy"].provider).toBe("opencode");
    expect(kinds["oc-proxy"].extends).toBeUndefined();
    expect(kinds["oc-proxy"].launch).toEqual({
      command: "scripts/opencode-cpe.sh",
      sessionFlag: "--session",
    });
    expect(kinds.opencode.launch).toEqual({ builtin: "opencode" });
  });

  it("profile overlay can replace CPE launch script", () => {
    const kinds = resolveAgentKinds({
      fromProviders: PROVIDER_KINDS,
      fromProfile: {
        "oc-proxy": { launch: { command: "scripts/my-cpe.sh" } },
      },
    });
    expect(kinds["oc-proxy"].launch).toEqual({ command: "scripts/my-cpe.sh" });
    expect(kinds["oc-proxy"].provider).toBe("opencode");
  });

  it("runners shim overlays launch.command", () => {
    const kinds = resolveAgentKinds({
      fromProviders: PROVIDER_KINDS,
      runners: { "oc-proxy": "scripts/from-runners.sh" },
    });
    expect(kinds["oc-proxy"].launch).toEqual({ command: "scripts/from-runners.sh" });
  });

  it("aliases resolve via knownAgentKindIds", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    const known = knownAgentKindIds(kinds);
    expect(known.has("oc")).toBe(true);
    expect(known.has("oc-proxy")).toBe(true);
  });
});

describe("launchCmdFromKind", () => {
  const ws = "/tmp/pia";

  it("launches CPE wrapper for resolved oc-proxy", () => {
    const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });
    const cmd = launchCmdFromKind(kinds["oc-proxy"], ws, "ses_abc");
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

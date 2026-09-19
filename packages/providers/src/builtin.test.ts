import { describe, expect, it } from "vitest";
import { launchCmdFromKind } from "@seat-mesh/core";
import { createBuiltinRegistry, normalizeProviderEnableIds, resolveKindsForProfile } from "./builtin.js";

describe("normalizeProviderEnableIds", () => {
  it("maps opencode-cpe / oc aliases to opencode provider", () => {
    expect(normalizeProviderEnableIds(["opencode-cpe", "oc", "cursor"])).toEqual([
      "opencode",
      "cursor-agent",
    ]);
  });

  it("maps legacy providers: oc-proxy to opencode (pia/zsign config)", () => {
    expect(normalizeProviderEnableIds(["oc-proxy", "claude"])).toEqual(["opencode", "claude"]);
  });

  it("keeps unknown kinds for future providers", () => {
    expect(normalizeProviderEnableIds(["kimi", "claude"])).toEqual(["kimi", "claude"]);
  });
});

describe("createBuiltinRegistry", () => {
  it("enables opencode detect when profile lists opencode-cpe", () => {
    const reg = createBuiltinRegistry(["cursor-agent", "opencode-cpe", "empty"]);
    expect(reg.get("opencode")).toBeTruthy();
    expect(reg.get("cursor-agent")).toBeTruthy();
    expect(reg.get("claude")).toBeUndefined();
  });
});

describe("resolveKindsForProfile", () => {
  it("emits opencode-cpe as extension of opencode from provider kindBase", () => {
    const kinds = resolveKindsForProfile({
      providers: ["opencode", "empty"],
      agents: { runners: {}, kinds: {} },
    });
    expect(kinds.opencode.provider).toBe("opencode");
    expect(kinds["opencode-cpe"].provider).toBe("opencode");
    expect(kinds["opencode-cpe"].launch).toMatchObject({
      command: "scripts/opencode-cpe.sh",
    });
  });

  it("runners.oc-proxy shim lands on opencode-cpe launch", () => {
    const kinds = resolveKindsForProfile({
      providers: ["oc-proxy", "empty"],
      agents: {
        runners: { "oc-proxy": "scripts/from-legacy-key.sh" },
        kinds: {},
      },
    });
    expect(kinds["opencode-cpe"].launch).toEqual({ command: "scripts/from-legacy-key.sh" });
  });

  it("E2E: custom agents.kinds.my-oc extending the real opencode provider (TODO 6.6)", () => {
    // No-fork DX path (docs/EXAMPLE-CUSTOM-KIND-KIMI.md): a profile-authored
    // overlay extending a real provider's kindBase, not a synthetic fixture map —
    // proves layer 1 (kind resolve) and layer 3 (launch cmd) agree end to end.
    const kinds = resolveKindsForProfile({
      providers: ["opencode", "empty"],
      agents: {
        runners: {},
        kinds: {
          "my-oc": {
            extends: "opencode",
            aliases: ["myoc"],
            launch: { command: "scripts/my-oc.sh", sessionFlag: "--session" },
          },
        },
      },
    });
    const myOc = kinds["my-oc"];
    expect(myOc).toBeDefined();
    expect(myOc.provider).toBe("opencode"); // inherited from opencode's kindBase
    expect(myOc.aliases).toEqual(["myoc"]);

    const cmd = launchCmdFromKind(myOc, "/work", "ses_abc123");
    expect(cmd).toContain("scripts/my-oc.sh");
    expect(cmd).toContain("--session ses_abc123");
    expect(cmd).toContain("/work");

    // save's mesh-agents.json `type` field is an open string (P6 migration) —
    // no schema change needed for a seat launched on a custom kind.
    const noResume = launchCmdFromKind(myOc, "/work", null);
    expect(noResume).not.toContain("--session");
  });
});

import { describe, expect, it } from "vitest";
import type { PaneSnapshot } from "../providers/types.js";
import {
  entryWantsProxyRecovery,
  kindProveMatches,
  liveKindSatisfiesWanted,
  resolveLiveHarnessKind,
  resumeCmdMatchesKindProve,
} from "./harness-satisfy.js";
import { resolveAgentKinds, type AgentKindDef } from "./kinds.js";

const PROVIDER_KINDS: Record<string, AgentKindDef> = {
  opencode: {
    provider: "opencode",
    aliases: ["oc"],
    launch: { builtin: "opencode" },
  },
  "opencode-cpe": {
    extends: "opencode",
    launch: { command: "scripts/opencode-cpe.sh", sessionFlag: "--session" },
    prove: {
      cmdline: ["opencode-cpe\\.sh", "HTTPS_PROXY=.*18887"],
      resumeCmd: ["opencode-cpe\\.sh"],
    },
    satisfy: { whenProvider: "opencode", requireProve: true },
    recovery: {
      onProxyUp: true,
      continueCopy: "CONTINUE CPE test copy",
    },
  },
  empty: { provider: "empty", launch: null },
};

function snap(partial: Partial<PaneSnapshot> & Pick<PaneSnapshot, "paneId">): PaneSnapshot {
  return {
    windowName: "base",
    cwd: "/tmp",
    currentCommand: "opencode",
    captureTail: "",
    options: {},
    ...partial,
  };
}

describe("harness-satisfy", () => {
  const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });

  it("prove matches CPE resumeCmd", () => {
    expect(
      kindProveMatches(kinds["opencode-cpe"], {
        resumeCmd: "/ws/scripts/opencode-cpe.sh --session ses_x",
      }),
    ).toBe(true);
    expect(kindProveMatches(kinds["opencode-cpe"], { resumeCmd: "opencode --auto" })).toBe(false);
  });

  it("resolveLiveHarnessKind prefers prove over bare detect", () => {
    expect(
      resolveLiveHarnessKind({
        detectId: "opencode",
        savedType: "opencode-cpe",
        resumeCmd: "opencode-cpe.sh --session ses_x",
        kinds,
      }),
    ).toBe("opencode-cpe");
    expect(resolveLiveHarnessKind({ detectId: "opencode", kinds })).toBe("opencode");
  });

  it("liveKindSatisfiesWanted: CPE UI + saved opencode-cpe", () => {
    const s = snap({
      paneId: "%1",
      captureTail: "Build auto · Big Pickle\nctrl+p commands",
      options: { mesh_oc_session: "ses_abc" },
    });
    expect(
      liveKindSatisfiesWanted(
        "opencode",
        "opencode-cpe",
        { snap: s },
        kinds,
        { savedType: "opencode-cpe", resumeCmd: "opencode-cpe.sh --session ses_abc" },
      ),
    ).toBe(true);
  });

  it("liveKindSatisfiesWanted: bare OC does not satisfy opencode-cpe", () => {
    const s = snap({ paneId: "%1", captureTail: "zsh" });
    expect(liveKindSatisfiesWanted("opencode", "opencode-cpe", { snap: s }, kinds)).toBe(false);
  });

  it("entryWantsProxyRecovery uses kind.recovery.onProxyUp", () => {
    expect(entryWantsProxyRecovery({ type: "opencode-cpe" }, kinds)).toBe(true);
    expect(
      entryWantsProxyRecovery(
        { type: "opencode", resume_cmd: "scripts/opencode-cpe.sh --session x" },
        kinds,
      ),
    ).toBe(true);
    expect(entryWantsProxyRecovery({ type: "opencode", resume_cmd: "opencode --auto" }, kinds)).toBe(
      false,
    );
    expect(entryWantsProxyRecovery({ type: "claude" }, kinds)).toBe(false);
  });

  it("resumeCmdMatchesKindProve", () => {
    expect(
      resumeCmdMatchesKindProve("cd /x && scripts/opencode-cpe.sh --session ses_1", kinds),
    ).toBe(true);
    expect(resumeCmdMatchesKindProve("opencode --auto", kinds)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { PaneSnapshot } from "@seat-mesh/core";
import { resolveAgentKinds, type AgentKindDef } from "@seat-mesh/core";
import {
  liveHarnessSatisfiesWanted,
  resolveOpenCodeHarnessType,
} from "./oc-proxy-live.js";

const PROVIDER_KINDS: Record<string, AgentKindDef> = {
  opencode: {
    provider: "opencode",
    launch: { builtin: "opencode" },
  },
  "oc-proxy": {
    extends: "opencode",
    launch: { command: "scripts/opencode-cpe.sh" },
    prove: {
      cmdline: ["opencode-cpe\\.sh", "HTTPS_PROXY=.*18887"],
      resumeCmd: ["opencode-cpe\\.sh"],
    },
    satisfy: { whenProvider: "opencode", requireProve: true },
    recovery: { onProxyUp: true },
  },
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

describe("oc-proxy-live harness label", () => {
  const kinds = resolveAgentKinds({ fromProviders: PROVIDER_KINDS });

  it("maps detect=opencode + mesh-agents oc-proxy → oc-proxy", () => {
    expect(
      resolveOpenCodeHarnessType({
        detectId: "opencode",
        savedType: "oc-proxy",
        resumeCmd: "…/opencode-cpe.sh --session ses_x",
        kinds,
      }),
    ).toBe("oc-proxy");
  });

  it("keeps bare opencode when no CPE evidence", () => {
    expect(resolveOpenCodeHarnessType({ detectId: "opencode", kinds })).toBe("opencode");
  });

  it("does not kill CPE OC when wanted oc-proxy and UI live", () => {
    const s = snap({
      paneId: "%1",
      captureTail: "Build auto · Big Pickle\nctrl+p commands",
      options: { mesh_oc_session: "ses_abc" },
    });
    expect(
      liveHarnessSatisfiesWanted("opencode", "oc-proxy", s, {
        savedType: "oc-proxy",
        resumeCmd: "opencode-cpe.sh --session ses_abc",
        kinds,
      }),
    ).toBe(true);
  });

  it("does not treat bare opencode as oc-proxy without proof", () => {
    const s = snap({ paneId: "%1", captureTail: "zsh prompt" });
    expect(liveHarnessSatisfiesWanted("opencode", "oc-proxy", s, { kinds })).toBe(false);
  });

  it("legacy path without kinds still works", () => {
    expect(
      resolveOpenCodeHarnessType({
        detectId: "opencode",
        savedType: "oc-proxy",
        resumeCmd: "opencode-cpe.sh",
      }),
    ).toBe("oc-proxy");
  });
});

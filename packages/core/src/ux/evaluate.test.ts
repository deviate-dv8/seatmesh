import { describe, expect, it } from "vitest";
import type { PaneSnapshot } from "../providers/types.js";
import { evaluateUxRules, resolveUxConfig, uxLimitKinds } from "./evaluate.js";

function snap(tail: string, provider = "opencode"): PaneSnapshot {
  return {
    paneId: "%0",
    windowName: "workers",
    cwd: "/tmp",
    currentCommand: "opencode",
    captureTail: tail,
    options: {},
  };
}

describe("evaluateUxRules", () => {
  const config = resolveUxConfig({ useDefaults: true, rules: [] });

  it("detects oc-limit from scrollback", () => {
    const tail = "some output\nrate limit exceeded on this model\n";
    const hit = evaluateUxRules(snap(tail), "opencode", config);
    expect(hit?.state.phase).toBe("limit");
    expect(hit?.state.limitKind).toBe("oc-limit");
    expect(hit?.border).toBe("OC-LIMIT:oc-limit");
    expect(hit?.onRise).toBe("connectivity.rate-limit");
  });

  it("detects oc-connect without rate limit unless", () => {
    const tail = "Cannot connect to API server\n";
    const hit = evaluateUxRules(snap(tail), "opencode", config);
    expect(hit?.state.limitKind).toBe("oc-connect");
    expect(hit?.border).toBe("PROXY-DOWN");
  });

  it("cursor idle follow-up chrome is empty (inbox deliverable)", () => {
    const tail =
      "assistant text\n \u2192 Add a follow-up\n Composer 2.5 Fast \u00b7 37.4% \u00b7 1 file edited\n ~/proj\n";
    const hit = evaluateUxRules(snap(tail, "cursor-agent"), "cursor-agent", config);
    expect(hit?.ruleId).toBe("cursor-idle-chrome");
    expect(hit?.state.phase).toBe("empty");
  });

  it("blank lines in capture do not classify as plain_shell", () => {
    const tail = [
      "assistant reply",
      "",
      "more text",
      "",
      "  Compose\u00b7 89 \u00b7105      Run Everything",
      "  ~/Desktop/Work/zsign",
    ].join("\n");
    const hit = evaluateUxRules(
      { ...snap(tail, "agent"), currentCommand: "agent" },
      "cursor-agent",
      config,
    );
    expect(hit?.state.phase).not.toBe("plain_shell");
    expect(hit?.state.phase).toBe("empty");
  });

  it("truly empty capture is plain_shell", () => {
    const hit = evaluateUxRules(snap("   \n  \n"), "cursor-agent", config);
    expect(hit?.ruleId).toBe("plain-empty");
    expect(hit?.state.phase).toBe("plain_shell");
  });

  it("composer idle wins over stale limit text", () => {
    const tail = [
      "old rate limit line",
      "",
      "Ask anything",
      "Build auto · Big Pickle OpenCode Zen",
      "ctrl+p commands",
    ].join("\n");
    const hit = evaluateUxRules(snap(tail), "opencode", config);
    expect(hit?.state.phase).toBe("empty");
  });

  it("classifies limit kinds for connectivity", () => {
    const kinds = uxLimitKinds(config);
    expect(kinds.proxyDownKinds.has("oc-connect")).toBe(true);
    expect(kinds.rateLimitKinds.has("oc-limit")).toBe(true);
    expect(kinds.limitProviders.has("opencode")).toBe(true);
  });

  it("custom rule overrides default by id", () => {
    const cfg = resolveUxConfig({
      useDefaults: true,
      rules: [
        {
          id: "oc-limit",
          for: ["opencode"],
          priority: 100,
          when: { scan: { full: true }, match: "CUSTOM-LIMIT" },
          set: { phase: "limit", kind: "my-limit", border: "MY-LIMIT" },
        },
      ],
    });
    const hit = evaluateUxRules(snap("CUSTOM-LIMIT\n"), "opencode", cfg);
    expect(hit?.state.limitKind).toBe("my-limit");
    expect(hit?.border).toBe("MY-LIMIT");
  });
});

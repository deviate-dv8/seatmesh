import { describe, expect, it } from "vitest";
import {
  agentInputDraft,
  claudeInputDraft,
  composerFromCapture,
  coordComposerDraft,
  isDecorativeChromeNeighbor,
} from "./shared.js";

describe("claudeInputDraft (FQ-inject-co-typed-pane)", () => {
  it("collects a wrapped multi-line human draft, not just the first visual line", () => {
    const tail = "❯ fix the login page so it\n  handles the timeout case too\n";
    expect(claudeInputDraft(tail)).toBe("fix the login page so it handles the timeout case too");
  });

  it("never mistakes the 'edit queued messages' hint for a draft", () => {
    const tail = "───\n❯ Press up to edit queued messages\n───\n";
    expect(claudeInputDraft(tail)).toBe("");
  });

  it("returns empty when there is no live prompt line", () => {
    expect(claudeInputDraft("Thinking...\n")).toBe("");
  });

  it("reads auto-mode live composer between dividers", () => {
    const tail =
      "✻ Baked for 35s · done 10:12 AM\n" +
      "─".repeat(40) +
      "\n❯ some text here for manager-1 to test\n" +
      "─".repeat(40) +
      "\n  ⏵⏵ auto mode on (shift+tab to cycle)\n";
    expect(claudeInputDraft(tail)).toBe("some text here for manager-1 to test");
  });

  it("ignores a scrollback chip without auto-mode footer", () => {
    const tail =
      "✨ Baked for 4m 13s · done 9:44 PM\n" +
      "─".repeat(40) +
      "\n❯ yes post it\n" +
      "─".repeat(40) +
      "\n";
    expect(claudeInputDraft(tail)).toBe("");
  });
});

describe("isDecorativeChromeNeighbor", () => {
  it("true when either neighbor is a rule/divider line", () => {
    expect(isDecorativeChromeNeighbor("────", "")).toBe(true);
    expect(isDecorativeChromeNeighbor("", "────")).toBe(true);
  });

  it("false for ordinary text neighbors", () => {
    expect(isDecorativeChromeNeighbor("some prior line", "  continuation")).toBe(false);
    expect(isDecorativeChromeNeighbor("", "")).toBe(false);
  });
});

describe("composerFromCapture (border/typing status)", () => {
  it("reports typing for auto-mode composer row between dividers (live secretary pane)", () => {
    const tail =
      "✻ Baked for 35s · done 10:12 AM\n" +
      "─".repeat(40) +
      "\n❯ some text here for manager-1 to test\n" +
      "─".repeat(40) +
      "\n  ⏵⏵ auto mode on (shift+tab to cycle)\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "claude")).toEqual({
      phase: "typing",
      draftFingerprint: "some text here for manager-1 to test",
    });
  });

  it("does not report typing for a scrollback chip without auto-mode footer", () => {
    const tail =
      "✨ Baked for 4m 13s · done 9:44 PM\n" +
      "─".repeat(40) +
      "\n❯ yes post it\n" +
      "─".repeat(40) +
      "\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "claude")).toEqual({ phase: "empty" });
  });

  it("still reports typing for a real live draft with no surrounding dividers", () => {
    const tail = "some prior output\n❯ fix the thing\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "claude")).toEqual({
      phase: "typing",
      draftFingerprint: "fix the thing",
    });
  });

  it("claude provider rate limit is cc-limit (not oc-limit from shared OC_LIMIT_RE)", () => {
    const tail =
      "You've hit your rate limit.\nTry again in 2 hours.\n\n❯ \n  ⏭⏭ auto mode on\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "claude")).toEqual({
      phase: "limit",
      limitKind: "cc-limit",
    });
  });

  it("empty CC composer with rule-only prompt row is not typing (2026-09-13 wedge)", () => {
    const tail =
      "✻ Brewed for 0s · done\n" +
      "──────────────────────────\n" +
      "❯ ──────────────────────\n" +
      "  ──── ⏵⏵ auto mode on\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "claude")).toEqual({ phase: "empty" });
    expect(claudeInputDraft(tail)).toBe("");
  });

  it("empty CC composer stays empty when scrollback mentions thinking (not BUSY)", () => {
    const tail =
      "* Pouncing… (15s · still thinking)\n" +
      "  tmux detected · scroll with PgUp/PgDn\n" +
      "────────────────────────────────────\n" +
      "❯ \n" +
      "────────────────────────────────────\n" +
      "  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "claude")).toEqual({ phase: "empty" });
  });
});

describe("agentInputDraft (cursor ghost-text / placeholders)", () => {
  it("idle follow-up chrome is empty composer (secretary inbox wedge)", () => {
    const tail =
      "some assistant output\n" +
      " \u2192 Add a follow-up\n" +
      " Composer 2.5 Fast \u00b7 37.4% \u00b7 1 file edited      Run Everything\n" +
      " ~/Desktop/Work/zsign\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "cursor-agent")).toEqual({ phase: "empty" });
  });

  it("cursor usage-limit block is limit (not stuck busy)", () => {
    const tail =
      "Error: Increase limits for faster responses — You're out of usage. Switch to Auto\n";
    const pane = { captureTail: tail, currentCommand: "agent" } as Parameters<
      typeof composerFromCapture
    >[0];
    expect(composerFromCapture(pane, "cursor-agent")).toEqual({
      phase: "limit",
      limitKind: "cursor-usage-limit",
    });
  });

  it("active generate + follow-up is busy", () => {
    const tail =
      " \u2192 Add a follow-up  ctrl+c to stop\n Working...\n";
    const pane = { captureTail: tail } as Parameters<typeof composerFromCapture>[0];
    expect(composerFromCapture(pane, "cursor-agent").phase).toBe("busy");
  });

  it("treats Plan, search, build anything as empty (placeholder, not a draft)", () => {
    const tail = "  \u2192 Plan, search, build anything\n  Add a follow-up";
    expect(agentInputDraft(tail)).toBe("");
  });

  it("strips all-gray ghost suggestion via ANSI capture", () => {
    const tail = "  \u2192 Plan, search, build anything";
    const ansi = "  \x1b[2m\u2192 Plan, search, build anything\x1b[0m";
    expect(agentInputDraft(tail, ansi)).toBe("");
  });

  it("keeps typed prefix when only the suffix is gray ghost text", () => {
    const tail = "  \u2192 fix inbox draft Plan, search, build anything";
    const ansi =
      "  \u2192 fix inbox draft \x1b[38;5;245mPlan, search, build anything\x1b[39m";
    expect(agentInputDraft(tail, ansi)).toBe("fix inbox draft");
  });

  it("checkback mesh-inbox arrow chrome is not a human draft", () => {
    const tail =
      "  \u2192 [mesh-inbox]\n" +
      "    intent=checkback-verify manager |\n" +
      "    Check: peer:mini-1 reply —\n" +
      "  Compose\u00b7 89 \u00b7105      Run Everything\n";
    expect(agentInputDraft(tail)).toBe("");
    const pane = { captureTail: tail, currentCommand: "agent" } as Parameters<
      typeof composerFromCapture
    >[0];
    expect(composerFromCapture(pane, "cursor-agent").phase).toBe("empty");
  });
});

describe("coordComposerDraft dispatch", () => {
  it("routes claude through claudeInputDraft (previously always empty — gate blind spot)", () => {
    const tail = "❯ fix the banner overflow so it\n  wraps on mobile too\n";
    expect(coordComposerDraft(tail, "claude")).toBe(
      "fix the banner overflow so it wraps on mobile too",
    );
  });

  it("still empty for a provider with no draft heuristic", () => {
    expect(coordComposerDraft("❯ something", "kiro")).toBe("");
  });
});

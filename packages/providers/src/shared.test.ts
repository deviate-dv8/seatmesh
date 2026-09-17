import { describe, expect, it } from "vitest";
import {
  agentInputDraft,
  claudeInputDraft,
  composerFromCapture,
  coordComposerDraft,
  isDecorativeChromeNeighbor,
  kiroInputDraft,
  opencodeComposerReady,
  opencodeInputDraft,
  scrapePromptTurnOpenCode,
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

  it("kiro monthly usage limit is kiro-limit (queue held, not busy)", () => {
    const tail =
      "The monthly usage limit has been reached (request_id:a1b2c3d4-e5f6-7890-abcd-ef1234567890)\n" +
      "❯ \n";
    const pane = { captureTail: tail, currentCommand: "kiro-cli" } as Parameters<
      typeof composerFromCapture
    >[0];
    expect(composerFromCapture(pane, "kiro")).toEqual({
      phase: "limit",
      limitKind: "kiro-limit",
    });
  });

  it("orcarouter insufficient_user_quota is oc-credit (not oc-limit / CPE reboot)", () => {
    const tail =
      "Error from provider (Console): Upstream request failed: [insufficient_user_quota] " +
      "You're out of credits — this request needs $0.03. Add credits to keep going: " +
      "https://www.orcarouter.ai/console/billing?ref=err_credit_gate#add-credits " +
      "(request id: 202609170451137268947328268d9d6wefAJkAf)\n" +
      "ctrl+p commands\n";
    const pane = { captureTail: tail, currentCommand: "opencode" } as Parameters<
      typeof composerFromCapture
    >[0];
    expect(composerFromCapture(pane, "opencode")).toEqual({
      phase: "limit",
      limitKind: "oc-credit",
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

  it("routes kiro through kiroInputDraft (was always empty — restore never fired)", () => {
    expect(coordComposerDraft("❯ something", "kiro")).toBe("something");
    expect(kiroInputDraft("› fix the kiro draft wrap\n  on the next line\n")).toBe(
      "fix the kiro draft wrap on the next line",
    );
  });

  it("routes opencode through box-row draft heuristic (not scrollback)", () => {
    const tail =
      "assistant said something earlier about the proxy\n\n" +
      "▣  Build · Big Pickle · 4.7s\n" +
      "┃\n" +
      "┃  please restore this draft after inject\n" +
      "┃\n" +
      "┃  Build auto · gpt-5 · OpenCode Zen\n" +
      "ctrl+p commands\n";
    expect(opencodeInputDraft(tail)).toBe("please restore this draft after inject");
    expect(coordComposerDraft(tail, "opencode")).toBe("please restore this draft after inject");
  });

  it("opencode empty ┃ box is not a draft (scrollback must not vacuum)", () => {
    const tail =
      "Draft restore marker 9902 acknowledged — FYI only\n\n" +
      "▣  Build · Big Pickle · 4.7s\n" +
      "┃\n┃\n┃\n" +
      "┃  Build auto · Big Pickle OpenCode Zen\n" +
      "ctrl+p commands\n";
    expect(opencodeInputDraft(tail)).toBe("");
  });
});

describe("scrapePromptTurnOpenCode (ChatFile quality)", () => {
  it("pairs ┃ user box with reply above ▣ Build (not footer chrome)", () => {
    const tail = [
      "┃",
      "┃  [mesh-inbox] OC-PROVE-1: FYI draft-",
      "┃  restore — do not cancel other work.",
      "┃",
      "",
      "     Acknowledged — OC-PROVE-1 draft-",
      "     restore marker seen, FYI only. No work",
      "     cancelled. mini-6 idle standby.",
      "",
      "     ▣  Build · Big Pickle · 3.9s",
      "",
      "  ┃",
      "  ┃",
      "  ┃  Build auto · Big Pickle OpenCode Zen",
      "   /home/dan/Desktop/  101.8K (5 ctrl+p",
      "   Work/zsign                    commands",
      "",
    ].join("\n");
    const pane = { captureTail: tail } as Parameters<typeof scrapePromptTurnOpenCode>[0];
    const turn = scrapePromptTurnOpenCode(pane);
    expect(turn).not.toBeNull();
    expect(turn!.humanPrompt).toContain("[mesh-inbox] OC-PROVE-1");
    expect(turn!.humanPrompt).toContain("do not cancel other work");
    expect(turn!.humanPrompt).not.toMatch(/Build ·|Build auto|ctrl\+p/);
    expect(turn!.agentResponse).toContain("Acknowledged — OC-PROVE-1");
    expect(turn!.agentResponse).not.toMatch(/Build auto|ctrl\+p/);
  });

  it("returns null for empty composer chrome (no false humanPrompt)", () => {
    const tail = [
      "     mini-6 idle standby.",
      "",
      "     ▣  Build · Big Pickle · 10.2s",
      "",
      "  ┃",
      "  ┃",
      "  ┃  Build auto · Big Pickle OpenCode Zen",
      "ctrl+p commands",
      "",
    ].join("\n");
    const pane = { captureTail: tail } as Parameters<typeof scrapePromptTurnOpenCode>[0];
    expect(scrapePromptTurnOpenCode(pane)).toBeNull();
  });

  it("skips Thought chrome and QUEUED tag", () => {
    const tail = [
      "┃  OC-PROVE-LONG-9911: Write a long detailed explanation",
      "┃",
      "",
      "     + Thought: 1.5s",
      "",
      "     The write is complete — 44 short paragraphs.",
      "",
      "     ▣  Build · Big Pickle · 4.8s",
      "  ┃",
      "  ┃  Build auto · Big Pickle OpenCode Zen",
      "",
    ].join("\n");
    const pane = { captureTail: tail } as Parameters<typeof scrapePromptTurnOpenCode>[0];
    const turn = scrapePromptTurnOpenCode(pane);
    expect(turn!.humanPrompt).toContain("OC-PROVE-LONG-9911");
    expect(turn!.agentResponse).toContain("The write is complete");
    expect(turn!.agentResponse).not.toMatch(/Thought:/);
  });

  it("ignores in-flight Build (no duration) and keeps prior completed turn", () => {
    const tail = [
      "┃  older prompt about peers",
      "┃",
      "",
      "     Standing by.",
      "",
      "     ▣  Build · Big Pickle · 25.9s",
      "",
      "  ┃",
      "  ┃  OC-SCRAPE-PROVE-9912: Reply with exactly",
      "  ┃  one short sentence: scrape-quality-ok.",
      "  ┃",
      "",
      "     ▣  Build · Big Pickle",
      "",
      "  ┃",
      "  ┃  Build auto · Big Pickle OpenCode Zen",
      "   esc interrupt",
      "",
    ].join("\n");
    const pane = { captureTail: tail } as Parameters<typeof scrapePromptTurnOpenCode>[0];
    const turn = scrapePromptTurnOpenCode(pane);
    expect(turn!.humanPrompt).toContain("older prompt about peers");
    expect(turn!.agentResponse).toContain("Standing by");
    expect(turn!.humanPrompt).not.toContain("OC-SCRAPE-PROVE");
  });
});

describe("opencodeComposerReady", () => {
  it("is ready when composer and connect tip both appear (CPE boot)", () => {
    const tail = [
      "  ┃  Ask anything…",
      "  ┃  Build auto · Big Pickle OpenCode Zen",
      "                                                          tab agents  ctrl+p commands",
      "                   ● Tip Run /connect to add an AI provider and start coding",
    ].join("\n");
    const pane = {
      captureTail: tail,
      currentCommand: "opencode",
      options: { processCmdlines: "opencode\0" },
    } as unknown as Parameters<typeof opencodeComposerReady>[0];
    expect(opencodeComposerReady(pane)).toBe(true);
  });

  it("is not ready on connect splash alone (no composer chrome)", () => {
    const tail = "● Tip Run /connect to add an AI provider and start coding";
    const pane = {
      captureTail: tail,
      currentCommand: "opencode",
      options: { processCmdlines: "opencode\0" },
    } as unknown as Parameters<typeof opencodeComposerReady>[0];
    expect(opencodeComposerReady(pane)).toBe(false);
  });
});

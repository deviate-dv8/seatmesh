import { describe, expect, it } from "vitest";
import {
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

  it("ignores a dimmed suggested-reply chip sandwiched between dividers (not a live draft)", () => {
    const tail =
      "✨ Baked for 4m 13s · done 9:44 PM\n" +
      "─".repeat(40) +
      "\n❯ yes post it\n" +
      "─".repeat(40) +
      "\n  ⏭⏭ auto mode on (shift+tab to cycle)\n";
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
  it("does not report typing for a suggestion chip flanked by dividers, even with empty composer", () => {
    const tail =
      "✨ Baked for 4m 13s · done 9:44 PM\n" +
      "─".repeat(40) +
      "\n❯ yes post it\n" +
      "─".repeat(40) +
      "\n  ⏭⏭ auto mode on (shift+tab to cycle)\n";
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

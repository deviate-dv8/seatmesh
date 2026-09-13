import { describe, expect, it } from "vitest";
import { claudeInputDraft, coordComposerDraft } from "./shared.js";

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

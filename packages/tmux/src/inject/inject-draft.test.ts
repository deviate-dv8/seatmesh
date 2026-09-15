import { describe, expect, it } from "vitest";
import { humanDraftToPreserve, isSmInjectText } from "./inject-draft.js";

describe("isSmInjectText", () => {
  it("classifies sm envelopes vs human text", () => {
    expect(isSmInjectText("[agent-manager-kiro-cursor-claude] hi")).toBe(true);
    expect(isSmInjectText("hello [sent:abc123]")).toBe(true);
    expect(isSmInjectText("[mesh-inbox] CONTINUE")).toBe(true);
    expect(isSmInjectText("fix the banner overflow")).toBe(false);
  });

  it("still recognizes the tag behind a seat prefix (operator-reported live bug)", () => {
    // formatRoomPeerNotify / formatRoomCoordNotify / formatWorkerInjectStamp all
    // prefix with "<seat> | " before the actual tag — a bare ^-anchored check
    // never matched these, so every room-fanout ping was misread as a human draft.
    expect(isSmInjectText("manager-2 | [mesh-inbox-room] managers | manager | msg 1 unseen")).toBe(
      true,
    );
    expect(isSmInjectText("secretary | [mesh-inbox] SUPERVISE: seatmesh agent contexts")).toBe(true);
    expect(isSmInjectText("manager-2 | Check: peer:manager reply — seatmesh agent checkback list")).toBe(
      true,
    );
  });
});

describe("humanDraftToPreserve", () => {
  it("does not preserve Cursor placeholder ghost as draft", () => {
    const tail = "  \u2192 Plan, search, build anything\n  Add a follow-up";
    expect(humanDraftToPreserve(tail, "cursor-agent", "INJECT")).toBe("");
  });

  it("keeps a cursor human draft and skips sm / inject body", () => {
    const tail = "  \u2192 fix the banner overflow\n  Add a follow-up";
    expect(humanDraftToPreserve(tail, "cursor-agent", "INJECT")).toBe("fix the banner overflow");
    expect(humanDraftToPreserve(tail, "cursor-agent", "fix the banner overflow")).toBe("");
    const smTail = "  \u2192 [agent-manager] ASSIGN x\n";
    expect(humanDraftToPreserve(smTail, "cursor-agent", "INJECT")).toBe("");
  });

  it("claude: collects a wrapped multi-line human draft, not just the first visual line", () => {
    const tail = "\u276f fix the login page so it\n  handles the timeout case too\n";
    expect(humanDraftToPreserve(tail, "claude", "INJECT")).toBe(
      "fix the login page so it handles the timeout case too",
    );
  });

  it("claude: never mistakes the 'edit queued messages' hint for a draft", () => {
    const tail =
      "\u2500\u2500\u2500\n\u276f Press up to edit queued messages\n\u2500\u2500\u2500\n";
    expect(humanDraftToPreserve(tail, "claude", "INJECT")).toBe("");
  });

  it("claude: does not preserve a seat-prefixed room ping as a human draft", () => {
    const tail = "\u276f manager-2 | [mesh-inbox-room] managers | manager | msg 1 unseen\n";
    expect(humanDraftToPreserve(tail, "claude", "INJECT")).toBe("");
  });

  it("preserves human draft when inject body is mesh-inbox (not skipped for sm mail)", () => {
    const tail = "  \u2192 fix the login flow\n  Add a follow-up";
    expect(
      humanDraftToPreserve(tail, "cursor-agent", "[mesh-inbox] CONTINUE: read FOCUS.md"),
    ).toBe("fix the login flow");
  });

  it("preserves short human draft even when DIGEST body happens to include it", () => {
    const tail = "\u276f ok\n";
    const digest =
      "[mesh-inbox] DIGEST (2)\n---\n1. [from:x] please say ok when done\n---\n2. other";
    expect(humanDraftToPreserve(tail, "claude", digest)).toBe("ok");
  });

  it("kiro: preserves composer draft (coordComposerDraft used to always return empty)", () => {
    const tail = "\u276f restore my kiro notes about the banner\n";
    expect(humanDraftToPreserve(tail, "kiro", "INJECT")).toBe(
      "restore my kiro notes about the banner",
    );
  });

  it("opencode: preserves draft above Build auto footer", () => {
    const tail =
      "┃\n┃  rewrite the proxy health check\n┃\n" +
      "┃  Build auto · Big Pickle OpenCode Zen\nctrl+p commands\n";
    expect(humanDraftToPreserve(tail, "opencode", "INJECT")).toBe(
      "rewrite the proxy health check",
    );
  });
});

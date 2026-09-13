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
    expect(isSmInjectText("secretary | [mesh-inbox] SUPERVISE: ./sm.sh contexts")).toBe(true);
    expect(isSmInjectText("manager-2 | Check: peer:manager reply — ./sm.sh checkback list")).toBe(
      true,
    );
  });
});

describe("humanDraftToPreserve", () => {
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
});

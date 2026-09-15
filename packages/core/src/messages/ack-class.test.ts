import { describe, expect, it } from "vitest";
import { isAckClassPeer, stripPeerStamps } from "./ack-class.js";

describe("isAckClassPeer", () => {
  it("treats FYI/ACK lead tokens as ack-class", () => {
    expect(isAckClassPeer("FYI: chrome ok")).toBe(true);
    expect(isAckClassPeer("[mesh-inbox] [from:a to:b] ACK received — closing.")).toBe(true);
  });

  it("treats PASS / Noted closings as ack-class (no new ask)", () => {
    expect(
      isAckClassPeer(
        "[from:secretary to:manager] [agent-manager] FYI chrome+logs: PASS — status-left shows ok",
      ),
    ).toBe(true);
    expect(
      isAckClassPeer(
        "[from:secretary to:manager] ACK received — closing.",
      ),
    ).toBe(true);
    expect(isAckClassPeer("Noted PASS chrome+logs. Thanks.")).toBe(true);
    expect(
      isAckClassPeer("COORD PROVE 1.1.5 part 1: PASS — opencode --auto --session"),
    ).toBe(true);
  });

  it("treats PROG/DONE/PROVED progress as ack-class (no manager reply owed)", () => {
    expect(isAckClassPeer("PROG: auth slice 2/3")).toBe(true);
    expect(isAckClassPeer("DONE: gate-6 mirrored")).toBe(true);
    expect(isAckClassPeer("[from:slot-1 to:manager] PROVED chrome PASS")).toBe(true);
    expect(isAckClassPeer("WIP finished the redirect")).toBe(true);
  });

  it("keeps progress-with-ask as substance", () => {
    expect(isAckClassPeer("DONE: should I merge?")).toBe(false);
    expect(isAckClassPeer("BLOCKED: need manager to unlock ports")).toBe(false);
  });

  it("keeps real asks as substance", () => {
    expect(isAckClassPeer("please fix the banner overflow")).toBe(false);
    expect(isAckClassPeer("COORD PROVE: bring up workers then swap")).toBe(false);
  });
});

describe("stripPeerStamps", () => {
  it("drops leading brackets", () => {
    expect(stripPeerStamps("[mesh-inbox] [from:a to:b] FYI: hi")).toBe("FYI: hi");
  });
});

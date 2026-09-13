import { describe, expect, it } from "vitest";
import { isAckClassPeer } from "./peer-backlog.js";
import { isPeerDelivered, peerSentToken } from "../store/jsonl-store.js";
import type { PeerRow } from "../store/jsonl-store.js";

describe("peer backlog harden helpers", () => {
  it("extracts [sent:token] for dedupe", () => {
    expect(peerSentToken("hello\n[sent:smu049eezp47h]")).toBe("smu049eezp47h");
    expect(peerSentToken("no token")).toBeNull();
  });

  it("FIXED path is not ACK-class (must not follow-up-steer promote)", () => {
    const msg =
      "[from:manager-2 to:secretary] [agent-manager-kiro-cursor-claude] FIXED path (manager-2): flushed";
    expect(isAckClassPeer(msg)).toBe(false);
  });

  it("CONTINUE/REPORT/MINI-DONE are ACK-class for lead follow-up steer", () => {
    expect(
      isAckClassPeer(
        "[from:manager to:mini-1] [agent-manager-kiro-cursor-claude] CONTINUE one checkbox",
      ),
    ).toBe(true);
    expect(isAckClassPeer("[from:secretary to:manager] REPORT Dan: status")).toBe(true);
    expect(isAckClassPeer("MINI-DONE mini-1 PASS: ok")).toBe(true);
  });

  it("injectedPane marks delivered even when parked backlog", () => {
    const row: PeerRow = {
      id: "1",
      at: "",
      kind: "prompt",
      fromSlot: "manager",
      fromPorts: null,
      targetPane: "%16",
      targetLabel: "secretary",
      msg: "FIXED path\n[sent:smu049eezp47h]",
      sent: true,
      sentAt: "2026-01-01T00:00:00.000Z",
      deliverPane: "backlog",
      injectedPane: "%16",
      injectedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isPeerDelivered(row)).toBe(true);
    expect(peerSentToken(row.msg)).toBe("smu049eezp47h");
  });
});

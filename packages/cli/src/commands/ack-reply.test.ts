import { describe, expect, it } from "vitest";
import type { AckRow } from "@seat-mesh/core";
import {
  fromMatchesPeerTarget,
  pickAckForPeerTarget,
  shouldAutoAckReply,
} from "./ack-reply.js";

function row(partial: Partial<AckRow>): AckRow {
  return {
    id: "ack-aaaaaa1111",
    at: "2026-09-15T05:00:00.000Z",
    seat: "manager",
    paneId: "%21",
    source: "peer",
    ask: "do the thing",
    reminders: 0,
    ...partial,
  };
}

describe("ack reply helpers", () => {
  it("matches from seat to peer target", () => {
    expect(fromMatchesPeerTarget("secretary", "secretary")).toBe(true);
    expect(fromMatchesPeerTarget("worker-2", "slot-2")).toBe(true);
    expect(fromMatchesPeerTarget("mini-1", "mini-1")).toBe(true);
    expect(fromMatchesPeerTarget("manager", "secretary")).toBe(false);
  });

  it("picks oldest open ACK from the peer target", () => {
    const hit = pickAckForPeerTarget(
      [
        row({ id: "ack-old", at: "2026-09-15T04:00:00.000Z", from: "secretary" }),
        row({ id: "ack-new", at: "2026-09-15T05:00:00.000Z", from: "secretary" }),
        row({ id: "ack-other", from: "mini-1" }),
      ],
      "secretary",
    );
    expect(hit?.id).toBe("ack-old");
  });

  it("auto-acks ACK-class peer bodies", () => {
    expect(shouldAutoAckReply("ACK received — closing.", undefined)).toBe(true);
    expect(shouldAutoAckReply("FYI chrome+logs: PASS", undefined)).toBe(true);
    expect(shouldAutoAckReply("please fix banner", undefined)).toBe(false);
    expect(shouldAutoAckReply("ACK", "ack-explicit")).toBe(false);
  });
});

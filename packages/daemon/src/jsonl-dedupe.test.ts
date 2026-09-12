import { describe, expect, it } from "vitest";
import { dedupeJsonlRowsById, type PeerRow } from "./jsonl-store.js";

describe("dedupeJsonlRowsById", () => {
  it("prefers delivered row over stale pending duplicate", () => {
    const id = "399037c4-f65c-4407-a0dc-814177769440";
    const delivered: PeerRow = {
      id,
      at: "2026-09-12T10:35:25.409Z",
      kind: "prompt",
      fromSlot: "mesh-cold-start",
      fromPorts: null,
      targetPane: "%8",
      targetLabel: "slot-6",
      msg: "cold-start",
      sent: true,
      sentAt: "2026-09-12T11:17:47.504Z",
      deliverPane: "%8",
      deliverMode: "idle",
    };
    const pending: PeerRow = { ...delivered, sent: false, sentAt: undefined, deliverPane: undefined };
    const out = dedupeJsonlRowsById([pending, delivered, pending]);
    expect(out).toHaveLength(1);
    expect(out[0]?.sent).toBe(true);
    expect(out[0]?.sentAt).toBeTruthy();
  });
});

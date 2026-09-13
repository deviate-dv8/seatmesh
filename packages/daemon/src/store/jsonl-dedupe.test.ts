import { describe, expect, it } from "vitest";
import {
  dedupeJsonlRowsById,
  findDupInbox,
  findDupPeer,
  type PeerRow,
  type ToMasterRow,
} from "./jsonl-store.js";

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

describe("findDupPeer / findDupInbox", () => {
  const now = Date.parse("2026-09-13T10:00:00.000Z");
  const peer: PeerRow = {
    id: "p1",
    at: "2026-09-13T09:59:00.000Z",
    kind: "to-slot",
    fromSlot: "1",
    fromPorts: null,
    targetPane: "%3",
    targetLabel: "slot-2",
    msg: "hello",
    sent: false,
  };

  it("returns recent same target+body", () => {
    expect(findDupPeer([peer], { targetPane: "%3", msg: "hello", kind: "to-slot" }, now)?.id).toBe(
      "p1",
    );
  });

  it("ignores outside window", () => {
    expect(
      findDupPeer(
        [{ ...peer, at: "2026-09-13T09:50:00.000Z" }],
        { targetPane: "%3", msg: "hello" },
        now,
      ),
    ).toBeNull();
  });

  it("dedupes unresolved inbox same slot+body", () => {
    const row: ToMasterRow = {
      id: "i1",
      at: "2026-09-13T09:59:30.000Z",
      from: "worker",
      slot: "2",
      ports: null,
      msg: "ACK: x",
      sent: false,
      resolved: false,
      read: false,
    };
    expect(findDupInbox([row], { msg: "ACK: x", slot: "2" }, now)?.id).toBe("i1");
    expect(findDupInbox([{ ...row, resolved: true }], { msg: "ACK: x", slot: "2" }, now)).toBeNull();
  });
});

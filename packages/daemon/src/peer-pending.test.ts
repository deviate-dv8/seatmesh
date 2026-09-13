import { describe, expect, it } from "vitest";
import {
  countPeerPendingForPane,
  isPeerParked,
  isPeerPendingDelivery,
} from "./peer-pending.js";
import type { PeerRow } from "./jsonl-store.js";
import type { QueueStore } from "./create-queue-store.js";

function mockStore(peer: PeerRow[]): QueueStore {
  return {
    readPeer: () => peer,
  } as QueueStore;
}

describe("peer-pending", () => {
  it("treats backlog/skipped as parked not pending", () => {
    const row: PeerRow = {
      id: "1",
      at: "",
      kind: "prompt",
      fromSlot: "x",
      fromPorts: "-",
      targetPane: "%1",
      targetLabel: "slot-1",
      msg: "hi",
      sent: true,
      sentAt: "2026-01-01T00:00:00.000Z",
      deliverPane: "backlog",
    };
    expect(isPeerParked(row)).toBe(true);
    expect(isPeerPendingDelivery(row)).toBe(false);
    expect(countPeerPendingForPane(mockStore([row]), "%1")).toBe(0);
  });

  it("counts unsent peer for pane", () => {
    const pending: PeerRow = {
      id: "2",
      at: "",
      kind: "prompt",
      fromSlot: "x",
      fromPorts: "-",
      targetPane: "%1",
      targetLabel: "slot-1",
      msg: "hi",
      sent: false,
    };
    expect(countPeerPendingForPane(mockStore([pending]), "%1")).toBe(1);
  });
});

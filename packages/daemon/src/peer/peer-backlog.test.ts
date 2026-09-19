import { describe, expect, it } from "vitest";
import { isAckClassPeer, pendingPeerRows } from "./peer-backlog.js";
import { isPeerDelivered, peerSentToken } from "../store/jsonl-store.js";
import type { PeerRow } from "../store/jsonl-store.js";
import type { QueueStore } from "../store/create-queue-store.js";

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

  it("PASS / ACK received closings are ACK-class (no n+1 ask)", () => {
    expect(
      isAckClassPeer(
        "[from:secretary to:manager] [agent-manager] FYI chrome+logs: PASS — status ok",
      ),
    ).toBe(true);
    expect(isAckClassPeer("[from:secretary to:manager] ACK received — closing.")).toBe(true);
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

function mockStore(peer: PeerRow[]): QueueStore {
  return { readPeer: () => peer } as QueueStore;
}

function schedulableRow(overrides: Partial<PeerRow>): PeerRow {
  return {
    id: "s1",
    at: "2026-01-01T00:00:00.000Z",
    kind: "prompt",
    fromSlot: "operator",
    fromPorts: null,
    targetPane: "%1",
    targetLabel: "secretary",
    msg: "EOD digest",
    sent: false,
    ...overrides,
  };
}

describe("pendingPeerRows notBefore gate (sm schedule, TODO 2.5)", () => {
  it("holds a not-yet-due scheduled row out of drain", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const row = schedulableRow({ notBefore: future });
    expect(pendingPeerRows(mockStore([row]))).toEqual([]);
  });

  it("releases a scheduled row once notBefore passes", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const row = schedulableRow({ notBefore: past });
    expect(pendingPeerRows(mockStore([row]))).toEqual([row]);
  });

  it("a row with no notBefore drains immediately as before", () => {
    const row = schedulableRow({});
    expect(pendingPeerRows(mockStore([row]))).toEqual([row]);
  });

  it("still excludes delivered and backlog-parked rows regardless of notBefore", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const delivered = schedulableRow({ notBefore: past, sent: true, sentAt: past, deliverPane: "%1" });
    const backlog = schedulableRow({ id: "s2", notBefore: past, deliverPane: "backlog" });
    expect(pendingPeerRows(mockStore([delivered, backlog]))).toEqual([]);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import {
  INBOX_OVERLOAD_COOLDOWN_MS,
  INBOX_OVERLOAD_THRESHOLD,
  countInboxTriggersForPane,
  evaluateInboxOverload,
  overloadCooldownRemainingMs,
  resetInboxOverloadStateForTests,
} from "./inbox-overload.js";
import type { QueueStore } from "./create-queue-store.js";

function mockStore(peer: unknown[], checkbacks: unknown[]): QueueStore {
  return {
    readPeer: () => peer as ReturnType<QueueStore["readPeer"]>,
    readCheckbacks: () => checkbacks as ReturnType<QueueStore["readCheckbacks"]>,
  } as QueueStore;
}

describe("inbox overload", () => {
  beforeEach(() => resetInboxOverloadStateForTests());

  it("counts unsent peer only (not armed checkbacks)", () => {
    const store = mockStore(
      [{ targetPane: "%1", sent: false }],
      [{ status: "active", ownerPane: "%1" }],
    );
    expect(countInboxTriggersForPane(store, "%1")).toBe(1);
  });

  it("starts cooldown and warns at threshold", () => {
    const peers = Array.from({ length: INBOX_OVERLOAD_THRESHOLD }, (_, i) => ({
      targetPane: "%9",
      sent: false,
      id: `p${i}`,
    }));
    const store = mockStore(peers, []);
    const t0 = 1_000_000;
    const r = evaluateInboxOverload(store, "%9", t0);
    expect(r.hold).toBe(true);
    expect(r.warn).toBe(true);
    expect(r.warnMessage).toMatch(/OVERLOAD/);
    expect(overloadCooldownRemainingMs("%9", t0 + 1000)).toBe(INBOX_OVERLOAD_COOLDOWN_MS - 1000);
  });

  it("holds during cooldown even if count drops", () => {
    const peers = Array.from({ length: INBOX_OVERLOAD_THRESHOLD }, (_, i) => ({
      targetPane: "%9",
      sent: false,
      id: `p${i}`,
    }));
    const store = mockStore(peers, []);
    const t0 = 2_000_000;
    evaluateInboxOverload(store, "%9", t0);
    const r = evaluateInboxOverload(mockStore([], []), "%9", t0 + 60_000);
    expect(r.hold).toBe(true);
    expect(r.warn).toBeUndefined();
  });
});

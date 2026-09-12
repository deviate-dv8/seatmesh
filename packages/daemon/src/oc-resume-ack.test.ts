import { describe, expect, it } from "vitest";
import { nextAckWaveAction } from "./oc-resume-ack.js";

describe("nextAckWaveAction (OC-RESUME ack-confirmation wave)", () => {
  it("is idle when there is nothing to track", () => {
    expect(
      nextAckWaveAction({ total: 0, ackedCount: 0, startedAt: 0, timeoutNotified: false }, 1_000, 300_000),
    ).toBe("idle");
  });

  it("waits while some panes are still unconfirmed and under the timeout", () => {
    expect(
      nextAckWaveAction(
        { total: 3, ackedCount: 1, startedAt: 1_000, timeoutNotified: false },
        1_000 + 60_000,
        300_000,
      ),
    ).toBe("waiting");
  });

  it("reports all-acked once every pane has confirmed, regardless of elapsed time", () => {
    expect(
      nextAckWaveAction(
        { total: 3, ackedCount: 3, startedAt: 1_000, timeoutNotified: false },
        1_000 + 999_999,
        300_000,
      ),
    ).toBe("all-acked");
  });

  it("reports timeout once the threshold elapses with stragglers left", () => {
    expect(
      nextAckWaveAction(
        { total: 3, ackedCount: 1, startedAt: 1_000, timeoutNotified: false },
        1_000 + 300_000,
        300_000,
      ),
    ).toBe("timeout");
  });

  it("never re-fires timeout once already notified", () => {
    expect(
      nextAckWaveAction(
        { total: 3, ackedCount: 1, startedAt: 1_000, timeoutNotified: true },
        1_000 + 999_999,
        300_000,
      ),
    ).toBe("waiting");
  });

  it("prefers all-acked over timeout when both conditions technically hold", () => {
    expect(
      nextAckWaveAction(
        { total: 3, ackedCount: 3, startedAt: 1_000, timeoutNotified: false },
        1_000 + 300_000,
        300_000,
      ),
    ).toBe("all-acked");
  });
});

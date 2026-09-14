import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyCoordDelivery,
  COORD_IDLE_SETTLE_MS,
  COORD_STUCK_DRAFT_SEC,
  resetCoordGateState,
} from "./compose-gate.js";

const PANE = "%99";

describe("classifyCoordDelivery", () => {
  beforeEach(() => resetCoordGateState(PANE));

  it("holds while busy (generating)", () => {
    const r = classifyCoordDelivery(
      PANE,
      { phase: "busy", busyLabel: "Thinking" },
      "",
      "opencode",
      1_000_000,
    );
    expect(r.canDeliver).toBe(false);
    expect(r.phase).toBe("wait-busy");
  });

  it("holds while typing / draft", () => {
    const r = classifyCoordDelivery(
      PANE,
      { phase: "typing", draftFingerprint: "fix the inbox" },
      "",
      "cursor-agent",
      1_000_000,
    );
    expect(r.canDeliver).toBe(false);
    expect(r.phase).toBe("wait-typing");
    expect(r.clearInSec).toBeGreaterThan(0);
  });

  it("AFK stuck-draft: delivers with restore after stable age", () => {
    const t0 = 3_000_000;
    const fp = "some text here for manager-1 to test";
    const first = classifyCoordDelivery(
      PANE,
      { phase: "typing", draftFingerprint: fp },
      "",
      "claude",
      t0,
    );
    expect(first.canDeliver).toBe(false);
    expect(first.phase).toBe("wait-typing");
    const later = classifyCoordDelivery(
      PANE,
      { phase: "typing", draftFingerprint: fp },
      "",
      "claude",
      t0 + COORD_STUCK_DRAFT_SEC * 1000 + 500,
    );
    expect(later.canDeliver).toBe(true);
    expect(later.phase).toBe("idle");
    expect(later.draftFp).toBe(fp);
  });

  it("resets stuck clock when draft fingerprint changes", () => {
    const t0 = 4_000_000;
    classifyCoordDelivery(
      PANE,
      { phase: "typing", draftFingerprint: "aaa" },
      "",
      "claude",
      t0,
    );
    const mid = classifyCoordDelivery(
      PANE,
      { phase: "typing", draftFingerprint: "bbb" },
      "",
      "claude",
      t0 + COORD_STUCK_DRAFT_SEC * 1000 + 500,
    );
    expect(mid.canDeliver).toBe(false);
    expect(mid.phase).toBe("wait-typing");
  });

  it("waits settle after busy ends", () => {
    const t0 = 1_000_000;
    classifyCoordDelivery(
      PANE,
      { phase: "busy" },
      "",
      "opencode",
      t0,
    );
    const r = classifyCoordDelivery(
      PANE,
      { phase: "empty" },
      "ctrl+p commands\nAsk anything",
      "opencode",
      t0 + 1000,
    );
    expect(r.canDeliver).toBe(false);
    expect(r.phase).toBe("wait-settle");
    expect(r.settleInSec).toBeGreaterThan(0);
  });

  it("delivers after full settle window", () => {
    const t0 = 2_000_000;
    const tEdge = t0 + 100;
    classifyCoordDelivery(PANE, { phase: "busy" }, "", "opencode", t0);
    // Rising edge: first poll after generate stops starts both settle clocks.
    classifyCoordDelivery(
      PANE,
      { phase: "empty" },
      "ctrl+p commands",
      "opencode",
      tEdge,
    );
    const r = classifyCoordDelivery(
      PANE,
      { phase: "empty" },
      "ctrl+p commands",
      "opencode",
      tEdge + COORD_IDLE_SETTLE_MS + 100,
    );
    expect(r.canDeliver).toBe(true);
    expect(r.phase).toBe("idle");
  });
});

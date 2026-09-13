import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyCoordDelivery,
  COORD_IDLE_SETTLE_MS,
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

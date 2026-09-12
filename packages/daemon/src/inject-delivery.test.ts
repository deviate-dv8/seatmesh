import { describe, expect, it } from "vitest";
import { isCursorFollowUpSteer } from "./inject-delivery.js";

describe("isCursorFollowUpSteer", () => {
  it("true for follow-up busy label", () => {
    expect(
      isCursorFollowUpSteer({ phase: "busy", busyLabel: "follow-up" }, "", "cursor-agent"),
    ).toBe(true);
  });

  it("true when capture shows Add a follow-up", () => {
    expect(
      isCursorFollowUpSteer(
        { phase: "empty" },
        "→ Add a follow-up  ctrl+c to stop",
        "cursor-agent",
      ),
    ).toBe(true);
  });

  it("false for opencode busy", () => {
    expect(
      isCursorFollowUpSteer({ phase: "busy", busyLabel: "Thinking" }, "", "opencode"),
    ).toBe(false);
  });
});

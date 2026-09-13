import { describe, expect, it } from "vitest";
import {
  canDeliverNow,
  coTypedNotifyEligible,
  isCursorFollowUpSteer,
  isExplicitHubOverride,
  shouldSendCoTypedHoldToast,
} from "./inject-delivery.js";
import { shouldBacklogPeerHold } from "./peer-backlog.js";

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

  it("active follow-up generate is not deliverable; idle follow-up is empty", () => {
    expect(
      canDeliverNow({ phase: "busy", busyLabel: "follow-up" }, "Add a follow-up", "cursor-agent"),
    ).toBe(false);
    expect(canDeliverNow({ phase: "empty" }, "Add a follow-up", "cursor-agent")).toBe(true);
    expect(canDeliverNow({ phase: "busy" }, "ctrl+c to stop", "agent")).toBe(false);
    expect(shouldBacklogPeerHold("held:busy", "ASSIGN FQ6")).toBe(true);
    expect(shouldBacklogPeerHold("held:busy", "ACK NOTED")).toBe(true);
    expect(shouldBacklogPeerHold("held:cotyped:typing", "STATUS tick")).toBe(true);
    expect(shouldBacklogPeerHold("held:busy", "PRIORITY switch now")).toBe(false);
    expect(isExplicitHubOverride("PRIORITY switch now")).toBe(true);
    expect(isExplicitHubOverride("ASSIGN FQ6")).toBe(false);
  });

  it("coTypedNotifyEligible rejects STATUS and room status pings", () => {
    expect(coTypedNotifyEligible("manager-2 | [mesh-inbox-room] managers | status 10 unseen")).toBe(
      false,
    );
    expect(coTypedNotifyEligible("[mesh-inbox] SUPERVISE-STATUS: manager BUSY 3 open")).toBe(false);
    expect(coTypedNotifyEligible("[mesh-inbox] ASSIGN manager-2. Hub is FOCUS")).toBe(true);
  });

  it("shouldSendCoTypedHoldToast rate-limits non-urgent holds", () => {
    const pane = "%test-cotyped";
    const msg = "[mesh-inbox] DIGEST: mini done";
    expect(shouldSendCoTypedHoldToast(pane, msg)).toBe(true);
    expect(shouldSendCoTypedHoldToast(pane, msg)).toBe(false);
    expect(shouldSendCoTypedHoldToast(pane, "ASSIGN slot-1 do thing")).toBe(true);
  });

  it("false for claude, even mid-generate (FQ-inject-co-typed-pane: never steer-inject a co-typed pane)", () => {
    expect(isCursorFollowUpSteer({ phase: "busy" }, "· thinking", "claude")).toBe(false);
    expect(
      isCursorFollowUpSteer({ phase: "busy" }, "esc to interrupt", "claude"),
    ).toBe(false);
  });
});

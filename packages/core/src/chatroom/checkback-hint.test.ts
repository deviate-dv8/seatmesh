import { describe, expect, it } from "vitest";
import {
  formatCompactSeat,
  formatPeerReplyCmd,
  formatReplyToSender,
  formatRoomSayReplyCmd,
  formatToSlotReplyCmd,
  formatWorkerInjectStamp,
  peerTargetFromAgentId,
} from "./checkback-hint.js";

describe("formatCompactSeat", () => {
  it("labels manager coord pane", () => {
    expect(formatCompactSeat({ role: "manager" })).toBe("manager");
    expect(formatWorkerInjectStamp({ role: "manager" })).toBe("manager -");
  });
});

describe("reply cmd hints", () => {
  it("formats room / to-slot / peer one-liners", () => {
    expect(formatRoomSayReplyCmd("managers")).toBe(
      'seatmesh agent room say -r managers "<msg>"',
    );
    expect(formatToSlotReplyCmd(3)).toBe('to-slot 3 "<msg>"');
    expect(formatPeerReplyCmd("manager-2")).toBe(
      'seatmesh agent peer manager-2 "<msg>"',
    );
    expect(formatPeerReplyCmd("manager")).toBe('seatmesh agent peer manager "<msg>"');
    expect(peerTargetFromAgentId("worker-3")).toBe("slot-3");
    expect(peerTargetFromAgentId("manager-2")).toBe("manager-2");
    expect(peerTargetFromAgentId("mini-4")).toBe("mini-4");
    expect(peerTargetFromAgentId("manager-mini-4")).toBe("mini-4");
    expect(peerTargetFromAgentId("manager-mini")).toBe("mini-?");
    expect(formatReplyToSender("manager-2")).toContain("SHELL (required");
    expect(formatReplyToSender("manager-2")).toContain(
      'seatmesh agent peer manager-2 "<msg>"',
    );
    expect(formatReplyToSender("mini-4")).toContain("peer mini-4");
    expect(formatReplyToSender("worker-6")).toContain("peer slot-6");
  });
});

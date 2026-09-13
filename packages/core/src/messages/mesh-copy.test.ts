import { describe, expect, it } from "vitest";
import {
  formatSuperviseStatusLine,
  isSuperviseStatusBroadcast,
  meshInboxSuperviseStatus,
  MESH_INBOX_TAG,
  stripMeshOwnedLines,
} from "./mesh-copy.js";

describe("supervise status copy", () => {
  it("formats a one-line lead STATUS from the profile lead list", () => {
    expect(
      formatSuperviseStatusLine([
        { id: "manager", mark: "BUSY", open: 0 },
        { id: "lead-west", mark: "BUSY", open: 1 },
      ]),
    ).toBe("manager BUSY 0 open | lead-west BUSY 1 open");
  });

  it("includes every extra manager-kind lead", () => {
    expect(
      formatSuperviseStatusLine([
        { id: "manager", mark: "BUSY", open: 0 },
        { id: "lead-west", mark: "OPEN", open: 0 },
        { id: "lead-east", mark: "BUSY", open: 2 },
      ]),
    ).toBe("manager BUSY 0 open | lead-west OPEN 0 open | lead-east BUSY 2 open");
  });

  it("prefixes the daemon inject tag", () => {
    const line = formatSuperviseStatusLine([
      { id: "manager", mark: "OPEN", open: 0 },
      { id: "lead-west", mark: "BLOCKED", open: 2 },
    ]);
    expect(meshInboxSuperviseStatus(line)).toBe(
      `${MESH_INBOX_TAG} SUPERVISE-STATUS: manager OPEN 0 open | lead-west BLOCKED 2 open`,
    );
  });

  it("detects STATUS tick / operator override / queued rich notify", () => {
    expect(isSuperviseStatusBroadcast("status", "anything")).toBe(true);
    expect(isSuperviseStatusBroadcast("msg", "STATUS tick: PROG since last=none")).toBe(true);
    expect(isSuperviseStatusBroadcast("msg", "STATUS (operator override): DONE today")).toBe(true);
    expect(
      isSuperviseStatusBroadcast(
        "msg",
        "manager | [mesh-inbox-room] managers | secretary | msg (+7 more unseen)\nSTATUS tick: PROG",
      ),
    ).toBe(true);
    expect(isSuperviseStatusBroadcast("msg", "CLAIMED: slice")).toBe(false);
  });
});

describe("stripMeshOwnedLines", () => {
  it("drops inbox injects and OC-LIMIT banner leftovers", () => {
    const tail = [
      "old output",
      "[mesh-inbox] intent=limit-retry CONTINUE: resume",
      "slot-3 | [mesh-inbox] OC-LIMIT:oc-limit leftover",
      "Ask anything",
    ].join("\n");
    const stripped = stripMeshOwnedLines(tail);
    expect(stripped).toContain("old output");
    expect(stripped).toContain("Ask anything");
    expect(stripped).not.toMatch(/mesh-inbox/);
    expect(stripped).not.toMatch(/OC-LIMIT:/);
  });
});

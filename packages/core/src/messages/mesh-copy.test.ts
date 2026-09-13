import { describe, expect, it } from "vitest";
import {
  formatSuperviseStatusLine,
  isSuperviseStatusBroadcast,
  meshInboxSuperviseStatus,
  MESH_INBOX_TAG,
  stripMeshOwnedLines,
} from "./mesh-copy.js";

describe("supervise status copy", () => {
  it("formats a one-line lead STATUS", () => {
    expect(
      formatSuperviseStatusLine({
        managerMark: "BUSY",
        managerOpen: 0,
        manager2Mark: "BUSY",
        manager2Open: 1,
      }),
    ).toBe("manager BUSY 0 open | manager-2 BUSY 1 open");
  });

  it("prefixes the daemon inject tag", () => {
    const line = formatSuperviseStatusLine({
      managerMark: "OPEN",
      managerOpen: 0,
      manager2Mark: "BLOCKED",
      manager2Open: 2,
    });
    expect(meshInboxSuperviseStatus(line)).toBe(
      `${MESH_INBOX_TAG} SUPERVISE-STATUS: manager OPEN 0 open | manager-2 BLOCKED 2 open`,
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

import { describe, expect, it } from "vitest";
import type { CheckbackRow } from "../store/jsonl-store.js";
import { checkbackFirePriority, sortDueCheckbackIndices } from "./checkback-fire.js";

describe("checkbackFirePriority", () => {
  it("supervise beats comms", () => {
    expect(checkbackFirePriority("secretary-supervise")).toBeLessThan(
      checkbackFirePriority("room-comms"),
    );
  });
});

describe("sortDueCheckbackIndices", () => {
  it("due supervise fires before older generic checkback", () => {
    const now = Date.parse("2026-09-13T10:16:00.000Z");
    const stamp = "2026-09-13T10:00:00.000Z";
    const rows: CheckbackRow[] = [
      {
        id: "old-mini",
        kind: "checkback",
        status: "active",
        expiresAt: "2026-09-13T09:22:00.000Z",
        renewSec: 180,
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "mesh-secretary-supervise",
        kind: "secretary-supervise",
        status: "active",
        expiresAt: "2026-09-13T10:15:39.000Z",
        renewSec: 600,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    const order = sortDueCheckbackIndices(rows, now);
    expect(order).toEqual([1, 0]);
  });
});

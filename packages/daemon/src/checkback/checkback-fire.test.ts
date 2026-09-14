import { describe, expect, it } from "vitest";
import type { CheckbackRow } from "../store/jsonl-store.js";
import {
  CHECKBACK_MAX_FIRES,
  checkbackFirePriority,
  shouldRenewCheckback,
  sortDueCheckbackIndices,
} from "./checkback-fire.js";

describe("checkbackFirePriority", () => {
  it("supervise beats comms", () => {
    expect(checkbackFirePriority("secretary-supervise")).toBeLessThan(
      checkbackFirePriority("room-comms"),
    );
  });
});

describe("shouldRenewCheckback", () => {
  const base = (over: Partial<CheckbackRow> = {}): CheckbackRow => ({
    id: "cb-peer-1",
    kind: "comms",
    status: "active",
    renewSec: 180,
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...over,
  });

  it("caps ordinary CBs after CHECKBACK_MAX_FIRES", () => {
    const now = Date.parse("2026-09-14T10:05:00.000Z");
    expect(shouldRenewCheckback(base({ fireCount: CHECKBACK_MAX_FIRES - 1 }), now)).toBe(true);
    expect(shouldRenewCheckback(base({ fireCount: CHECKBACK_MAX_FIRES }), now)).toBe(false);
  });

  it("keeps supervise / mesh-watch renewing", () => {
    const now = Date.parse("2026-09-14T12:00:00.000Z");
    expect(
      shouldRenewCheckback(base({ kind: "secretary-supervise", fireCount: 99 }), now),
    ).toBe(true);
    expect(shouldRenewCheckback(base({ kind: "mesh-watch", fireCount: 99 }), now)).toBe(true);
  });

  it("one-shot when renewSec unset", () => {
    expect(shouldRenewCheckback(base({ renewSec: 0 }), Date.now())).toBe(false);
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

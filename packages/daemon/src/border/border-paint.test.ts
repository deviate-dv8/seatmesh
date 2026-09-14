import { describe, expect, it, beforeEach } from "vitest";
import {
  FULL_BANNER_PAINT_EVERY_TICK,
  applyStickyNegativeStatus,
  resetStickyNegativeStatus,
  selectWorkerMiniPaintTargets,
  type WorkerMiniPaintTarget,
} from "./border-paint.js";

function targets(n: number): WorkerMiniPaintTarget[] {
  return Array.from({ length: n }, (_, i) => ({
    paneId: `%${i + 1}`,
    label: `slot-${i + 1}`,
  }));
}

describe("applyStickyNegativeStatus", () => {
  beforeEach(() => resetStickyNegativeStatus());

  it("keeps CC-LIMIT when a later paint flickers to idle", () => {
    expect(
      applyStickyNegativeStatus("%s", "CC-LIMIT", { phase: "limit", limitKind: "cc-limit" }),
    ).toBe("CC-LIMIT");
    expect(applyStickyNegativeStatus("%s", "idle", { phase: "empty" })).toBe("CC-LIMIT");
    expect(applyStickyNegativeStatus("%s", "idle", null)).toBe("CC-LIMIT");
  });

  it("clears sticky after consecutive healthy empty paints", () => {
    applyStickyNegativeStatus("%s", "OC-LIMIT:oc-limit", {
      phase: "limit",
      limitKind: "oc-limit",
    });
    expect(applyStickyNegativeStatus("%s", "empty", { phase: "empty" })).toBe("OC-LIMIT:oc-limit");
    expect(applyStickyNegativeStatus("%s", "empty", { phase: "empty" })).toBe("empty");
  });
});

describe("selectWorkerMiniPaintTargets", () => {
  it("paints all panes on small meshes even with pending peer mail", () => {
    const all = targets(4);
    const pending = new Map([["%2", 1]]);
    const { selected } = selectWorkerMiniPaintTargets(all, pending, 0, 6);
    expect(selected).toHaveLength(4);
  });

  it("paints all panes when peer queue is idle", () => {
    const all = targets(14);
    const { selected } = selectWorkerMiniPaintTargets(all, new Map(), 3, 6);
    expect(selected).toHaveLength(14);
  });

  it("batches large meshes with pending mail but always includes priority panes", () => {
    const all = targets(14);
    expect(all.length).toBeGreaterThan(FULL_BANNER_PAINT_EVERY_TICK);
    const pending = new Map([["%3", 2], ["%11", 1]]);
    const { selected } = selectWorkerMiniPaintTargets(all, pending, 0, 6);
    expect(selected.length).toBeLessThanOrEqual(6);
    expect(selected.some((t) => t.paneId === "%3")).toBe(true);
    expect(selected.some((t) => t.paneId === "%11")).toBe(true);
  });

  it("rotates non-priority panes across ticks", () => {
    const all = targets(14);
    const pending = new Map([["%1", 1]]);
    const a = selectWorkerMiniPaintTargets(all, pending, 0, 6);
    const b = selectWorkerMiniPaintTargets(all, pending, a.nextOffset, 6);
    const idsA = new Set(a.selected.map((t) => t.paneId));
    const idsB = new Set(b.selected.map((t) => t.paneId));
    expect(idsA.has("%1")).toBe(true);
    expect(idsB.has("%1")).toBe(true);
    expect(idsA).not.toEqual(idsB);
  });
});

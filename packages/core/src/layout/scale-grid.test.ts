import { describe, expect, it } from "vitest";
import { gridForSlotCount, nextScaleCount, prevScaleCount } from "./scale-grid.js";

describe("scale-grid", () => {
  it("maps counts to grids", () => {
    expect(gridForSlotCount(1)).toBe("1x1");
    expect(gridForSlotCount(2)).toBe("2x1");
    expect(gridForSlotCount(4)).toBe("2x2");
    expect(gridForSlotCount(6)).toBe("3x2");
  });

  it("steps up/down the ladder", () => {
    expect(nextScaleCount(1)).toBe(2);
    expect(nextScaleCount(2)).toBe(3);
    expect(nextScaleCount(4)).toBe(6);
    expect(prevScaleCount(6)).toBe(4);
    expect(prevScaleCount(2)).toBe(1);
  });
});

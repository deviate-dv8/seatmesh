/** Pick COLSxROWS for a target pane count (layout scale up/down). */

import { gridPaneCapacity, parseGridSpec } from "./minis.js";

const PRESET: Record<number, string> = {
  1: "1x1",
  2: "2x1",
  3: "3x1",
  4: "2x2",
  5: "5x1",
  6: "3x2",
  7: "7x1",
  8: "4x2",
  9: "3x3",
  10: "5x2",
  12: "4x3",
};

/** Grid string whose capacity equals `n` (1..12). */
export function gridForSlotCount(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new Error(`scale count out of range 1..12 (got ${n})`);
  }
  const g = PRESET[n];
  if (g) return g;
  return `${n}x1`;
}

/** Next step size on the preset ladder (or +1). */
export function nextScaleCount(current: number, max = 12): number {
  const ladder = [1, 2, 3, 4, 6, 8, 9, 12].filter((x) => x <= max);
  for (const x of ladder) {
    if (x > current) return x;
  }
  return Math.min(max, current + 1);
}

/** Previous step size on the preset ladder (or -1). */
export function prevScaleCount(current: number, min = 1): number {
  const ladder = [12, 9, 8, 6, 4, 3, 2, 1].filter((x) => x >= min);
  for (const x of ladder) {
    if (x < current) return x;
  }
  return Math.max(min, current - 1);
}

export function assertGridMatchesSlots(grid: string, slots: number): void {
  parseGridSpec(grid);
  if (gridPaneCapacity(grid) !== slots) {
    throw new Error(`grid ${grid} capacity ${gridPaneCapacity(grid)} !== slots ${slots}`);
  }
}

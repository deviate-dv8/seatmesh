import { describe, expect, it } from "vitest";
import { expandTargetSpec, looksLikeTargetSpec } from "./target-range.js";

const opts = { workerCount: 6, miniMax: 8 };

describe("expandTargetSpec", () => {
  it("expands Ruby 1..4 to slots", () => {
    expect(expandTargetSpec("1..4", opts)).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
      "slot-4",
    ]);
  });

  it("expands slot-2..5 and mini-1..3", () => {
    expect(expandTargetSpec("slot-2..5", opts)).toEqual([
      "slot-2",
      "slot-3",
      "slot-4",
      "slot-5",
    ]);
    expect(expandTargetSpec("mini-1..3", opts)).toEqual([
      "mini-1",
      "mini-2",
      "mini-3",
    ]);
  });

  it("expands comma lists", () => {
    expect(expandTargetSpec("1,3,5", opts)).toEqual([
      "slot-1",
      "slot-3",
      "slot-5",
    ]);
  });

  it("passes single named targets through; bare digits → slot-N", () => {
    expect(expandTargetSpec("secretary", opts)).toEqual(["secretary"]);
    expect(expandTargetSpec("slot-2", opts)).toEqual(["slot-2"]);
    expect(expandTargetSpec("3", opts)).toEqual(["slot-3"]);
  });

  it("refuses out of range", () => {
    expect(() => expandTargetSpec("1..9", opts)).toThrow(/outside/);
  });
});

describe("looksLikeTargetSpec", () => {
  it("detects ranges and lists", () => {
    expect(looksLikeTargetSpec("1..4")).toBe(true);
    expect(looksLikeTargetSpec("1,2")).toBe(true);
    expect(looksLikeTargetSpec("secretary")).toBe(false);
  });
});

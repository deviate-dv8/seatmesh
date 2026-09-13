import { describe, expect, it } from "vitest";
import { columnWidthsPx } from "./base-layout.js";

describe("columnWidthsPx", () => {
  it("splits remainder equally after secretary pct (3 columns)", () => {
    expect(columnWidthsPx(100, ["manager", "manager-2", "secretary"], 40)).toEqual([
      30, 30, 40,
    ]);
  });

  it("gives leftover pixels to the last non-secretary column", () => {
    expect(columnWidthsPx(101, ["manager", "manager-2", "secretary"], 40)).toEqual([
      30, 31, 40,
    ]);
  });

  it("two-column: manager gets the rest", () => {
    expect(columnWidthsPx(100, ["manager", "secretary"], 40)).toEqual([60, 40]);
  });

  it("four columns: extra manager-kind split remaining width", () => {
    expect(
      columnWidthsPx(100, ["manager", "manager-2", "lead-west", "secretary"], 40),
    ).toEqual([20, 20, 20, 40]);
  });
});

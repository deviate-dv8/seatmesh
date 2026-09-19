import { describe, expect, it } from "vitest";
import { resolveScheduleAt } from "./schedule-cli.js";

describe("resolveScheduleAt", () => {
  it("accepts a relative duration", () => {
    const t0 = Date.now();
    const at = resolveScheduleAt("10m");
    expect(at).toBeTruthy();
    const ms = Date.parse(at!) - t0;
    expect(ms).toBeGreaterThan(9 * 60_000);
    expect(ms).toBeLessThan(11 * 60_000);
  });

  it("accepts a future absolute ISO time", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(resolveScheduleAt(future)).toBe(future);
  });

  it("falls back to duration parsing for a non-date, non-past string", () => {
    expect(resolveScheduleAt("2h")).toBeTruthy();
  });

  it("rejects garbage", () => {
    expect(resolveScheduleAt("not a time")).toBeNull();
    expect(resolveScheduleAt("")).toBeNull();
  });

  it("a past absolute time is not treated as absolute (falls through to duration parse, which also fails)", () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    // An ISO date string also happens to fail ms()'s relative-duration parse, so this is null.
    expect(resolveScheduleAt(past)).toBeNull();
  });
});

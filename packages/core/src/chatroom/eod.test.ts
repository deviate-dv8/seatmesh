import { describe, expect, it } from "vitest";
import { deadlineAtEod, parseTargetDeadline } from "./eod.js";

describe("eod / parseTargetDeadline", () => {
  it("eod is local end of day", () => {
    const now = new Date("2026-09-14T10:00:00");
    const end = deadlineAtEod(now);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("parses eod, duration, ISO", () => {
    const eod = parseTargetDeadline("eod", new Date("2026-09-14T08:00:00"));
    expect(eod.ok).toBe(true);
    if (eod.ok) expect(eod.deadlineAt).toContain("2026-09-14");

    const dur = parseTargetDeadline("2h", new Date("2026-09-14T08:00:00Z"));
    expect(dur.ok).toBe(true);

    const iso = parseTargetDeadline("2026-09-14T18:00:00.000Z");
    expect(iso.ok).toBe(true);
    if (iso.ok) expect(iso.deadlineAt).toBe("2026-09-14T18:00:00.000Z");

    expect(parseTargetDeadline("nope").ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  CC_LIMIT_RETRY_BUFFER_MS,
  ccLimitRetryFireAtMs,
  parseCcLimitRetryAtMs,
} from "./cc-limit-retry.js";
import {
  clearLimitIdleOverride,
  hasLimitIdleOverride,
  isLimitBorderStatus,
  setLimitIdleOverride,
} from "../border/limit-idle-override.js";

describe("parseCcLimitRetryAtMs", () => {
  // Fixed "now" = 2026-09-15 15:00 local
  const now = new Date(2026, 8, 15, 15, 0, 0, 0).getTime();

  it("parses try again at 6:40 PM", () => {
    const at = parseCcLimitRetryAtMs("You've hit your limit. try again at 6:40 PM", now);
    expect(at).not.toBeNull();
    const d = new Date(at!);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(40);
  });

  it("parses resets at 6:40PM (no space)", () => {
    const at = parseCcLimitRetryAtMs("resets at 6:40PM", now);
    expect(at).not.toBeNull();
    expect(new Date(at!).getHours()).toBe(18);
    expect(new Date(at!).getMinutes()).toBe(40);
  });

  it("fireAt = reset + 1 minute (6:40 → 6:41)", () => {
    const fire = ccLimitRetryFireAtMs("limit resets at 6:40 PM", now);
    const reset = parseCcLimitRetryAtMs("limit resets at 6:40 PM", now)!;
    expect(fire - reset).toBe(CC_LIMIT_RETRY_BUFFER_MS);
    const d = new Date(fire);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(41);
  });

  it("returns null without time or limit wording", () => {
    expect(parseCcLimitRetryAtMs("hello world", now)).toBeNull();
  });
});

describe("limit-idle override", () => {
  it("all-pane override forces idle without needing per-pane set", () => {
    clearLimitIdleOverride();
    const t0 = Date.now();
    setLimitIdleOverride("*", 60_000, t0);
    expect(hasLimitIdleOverride("%99", t0 + 1000)).toBe(true);
    expect(hasLimitIdleOverride("%1", t0 + 1000)).toBe(true);
    clearLimitIdleOverride();
    expect(hasLimitIdleOverride("%99", t0 + 1000)).toBe(false);
  });

  it("per-pane override expires", () => {
    clearLimitIdleOverride();
    const t0 = Date.now();
    // Floor is 60s — shorter requests still last a minute.
    setLimitIdleOverride("%12", 5_000, t0);
    expect(hasLimitIdleOverride("%12", t0 + 1000)).toBe(true);
    expect(hasLimitIdleOverride("%13", t0 + 1000)).toBe(false);
    expect(hasLimitIdleOverride("%12", t0 + 61_000)).toBe(false);
    clearLimitIdleOverride();
  });

  it("recognizes limit border statuses", () => {
    expect(isLimitBorderStatus("CC-LIMIT")).toBe(true);
    expect(isLimitBorderStatus("OC-LIMIT:foo")).toBe(true);
    expect(isLimitBorderStatus("idle")).toBe(false);
  });
});

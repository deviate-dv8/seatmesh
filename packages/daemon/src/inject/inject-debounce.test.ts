import { describe, expect, it } from "vitest";
import { injectDebounceReady } from "./inject-debounce.js";

const MS = 2500;
const MAX = 8000;

function row(atMs: number) {
  return { at: new Date(atMs).toISOString() };
}

describe("injectDebounceReady", () => {
  it("allows inject when debounce disabled", () => {
    expect(injectDebounceReady([row(0)], { ms: 0, maxMs: 8000 }, 10_000)).toBe(true);
  });

  it("holds until trailing quiet window", () => {
    const t0 = 1_000_000;
    const pending = [row(t0), row(t0 + 500)];
    expect(injectDebounceReady(pending, { ms: MS, maxMs: MAX }, t0 + 2000)).toBe(false);
    expect(injectDebounceReady(pending, { ms: MS, maxMs: MAX }, t0 + 500 + MS)).toBe(true);
  });

  it("fires at max cap even when mail keeps arriving", () => {
    const t0 = 2_000_000;
    const pending = [row(t0), row(t0 + 7000)];
    expect(injectDebounceReady(pending, { ms: MS, maxMs: MAX }, t0 + 7500)).toBe(false);
    expect(injectDebounceReady(pending, { ms: MS, maxMs: MAX }, t0 + MAX)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { MeshProfileSchema } from "../schema/profile.js";
import { resolveAutoScrapeIntervalMs } from "./auto-scrape.js";

function baseProfile(overrides: Record<string, unknown> = {}) {
  return MeshProfileSchema.parse({
    name: "test",
    workspace: ".",
    session: {},
    seats: {},
    roles: {},
    ...overrides,
  });
}

describe("resolveAutoScrapeIntervalMs", () => {
  it("defaults to state interval", () => {
    const p = baseProfile({ state: { autoScrapeIntervalMs: 120_000 } });
    expect(resolveAutoScrapeIntervalMs(p)).toBe(120_000);
  });

  it("daemon.autoScrape false disables scrape", () => {
    const p = baseProfile({
      state: { autoScrapeIntervalMs: 60_000 },
      daemon: { autoScrape: false },
    });
    expect(resolveAutoScrapeIntervalMs(p)).toBe(0);
  });

  it("daemon.autoScrapeIntervalMs overrides state", () => {
    const p = baseProfile({
      state: { autoScrapeIntervalMs: 60_000 },
      daemon: { autoScrapeIntervalMs: 300_000 },
    });
    expect(resolveAutoScrapeIntervalMs(p)).toBe(300_000);
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildSkillManifest, runSkillCommand } from "./skill-cli.js";

describe("buildSkillManifest", () => {
  it("has a name, description, and at least one entry point", () => {
    const m = buildSkillManifest();
    expect(m.name).toBe("seatmesh");
    expect(m.description.length).toBeGreaterThan(0);
    expect(m.entryPoints.length).toBeGreaterThan(0);
  });

  it("commandCount matches the actual commands list length", () => {
    const m = buildSkillManifest();
    expect(m.commandCount).toBe(m.commands.length);
    expect(m.commands.length).toBeGreaterThan(50); // real CLI surface, not a stub
  });

  it("every command has a non-empty verb and usage", () => {
    const m = buildSkillManifest();
    for (const c of m.commands) {
      expect(c.verb.length).toBeGreaterThan(0);
      expect(c.usage.length).toBeGreaterThan(0);
    }
  });

  it("splits a multi-line help body into usage (first line) + description (rest)", () => {
    const m = buildSkillManifest();
    const campaign = m.commands.find((c) => c.verb === "campaign");
    expect(campaign).toBeDefined();
    expect(campaign?.usage).toContain("campaign create");
    expect(campaign?.description).toContain("Ticket-style campaigns");
    // description should not contain literal newlines (collapsed to one line)
    expect(campaign?.description.includes("\n")).toBe(false);
  });

  it("aliases are attached to their real verb, not listed as separate commands", () => {
    const m = buildSkillManifest();
    const cb = m.commands.find((c) => c.verb === "cb");
    expect(cb?.aliases).toContain("checkback");
    expect(m.commands.some((c) => c.verb === "checkback")).toBe(false);
  });

  it("commands are sorted alphabetically by verb (matches listHelpEntries)", () => {
    const m = buildSkillManifest();
    const verbs = m.commands.map((c) => c.verb);
    expect(verbs).toEqual([...verbs].sort());
  });
});

describe("runSkillCommand", () => {
  it("prints valid JSON when json=true", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    runSkillCommand(true);
    spy.mockRestore();
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]!);
    expect(parsed.name).toBe("seatmesh");
    expect(Array.isArray(parsed.commands)).toBe(true);
  });

  it("prints multi-line human-readable output when json=false", () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(s));
    runSkillCommand(false);
    spy.mockRestore();
    expect(logs.length).toBeGreaterThan(5);
    expect(logs[0]).toContain("seatmesh");
    expect(() => JSON.parse(logs[0]!)).toThrow(); // not a JSON blob
  });
});

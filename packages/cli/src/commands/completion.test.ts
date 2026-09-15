import { describe, expect, it } from "vitest";
import {
  completeArgv,
  listTopLevelCompletionWords,
  normalizeCompletionWords,
} from "./completion.js";

describe("completion", () => {
  it("lists top-level verbs including aliases and completion", () => {
    const w = listTopLevelCompletionWords();
    expect(w).toContain("peer");
    expect(w).toContain("whoami");
    expect(w).toContain("get"); // alias of hub
    expect(w).toContain("completion");
    expect(w).toContain("--profile");
  });

  it("strips npx seatmesh wrappers", () => {
    expect(normalizeCompletionWords(["npx", "seatmesh", "peer"])).toEqual(["peer"]);
    expect(normalizeCompletionWords(["npx", "--yes", "seatmesh", "agent"])).toEqual(["agent"]);
    expect(normalizeCompletionWords(["seatmesh", "--profile", ".sm", "help"])).toEqual(["help"]);
  });

  it("completes top-level prefix", () => {
    const hits = completeArgv(["seatmesh", "pee"], 1);
    expect(hits).toContain("peer");
    expect(hits.every((h) => h.startsWith("pee"))).toBe(true);
  });

  it("completes agent subverbs", () => {
    const hits = completeArgv(["seatmesh", "agent", "who"], 2);
    expect(hits).toContain("whoami");
  });

  it("completes switch cli types after target", () => {
    const hits = completeArgv(["seatmesh", "switch", "slot-1", "op"], 3);
    expect(hits).toContain("opencode");
  });

  it("completes hub entities", () => {
    const hits = completeArgv(["seatmesh", "hub", "to"], 2);
    expect(hits).toContain("todos");
  });

  it("completes after npx seatmesh", () => {
    const hits = completeArgv(["npx", "seatmesh", "ses"], 2);
    expect(hits).toContain("session");
    expect(hits).toContain("sessions");
  });
});

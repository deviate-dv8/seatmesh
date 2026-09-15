import { describe, expect, it } from "vitest";
import { classifySlack, PPA_IDLE_SLACK_SEC } from "./ppa.js";

describe("classifySlack", () => {
  it("busy composer is never slack", () => {
    expect(
      classifySlack({
        agent: "opencode",
        composer: "busy:busy",
        idleS: 9999,
        mark: "BUSY",
        tasksOpen: 3,
      }).slack,
    ).toBe(false);
  });

  it("short idle is not slack", () => {
    expect(
      classifySlack({
        agent: "agent",
        composer: "empty",
        idleS: PPA_IDLE_SLACK_SEC - 1,
        mark: "BUSY",
        tasksOpen: 1,
      }).slack,
    ).toBe(false);
  });

  it("OPEN mark alone without tasks is not slack", () => {
    expect(
      classifySlack({
        agent: "opencode",
        composer: "empty",
        idleS: 9999,
        mark: "OPEN",
        tasksOpen: 0,
      }).slack,
    ).toBe(false);
  });

  it("long idle + open tasks = slack", () => {
    const r = classifySlack({
      agent: "opencode",
      composer: "empty",
      idleS: 500,
      mark: "BUSY",
      tasksOpen: 1,
    });
    expect(r.slack).toBe(true);
    expect(r.reason).toMatch(/tasks=1/);
  });

  it("empty shell with no work is not slack", () => {
    expect(
      classifySlack({
        agent: "empty",
        composer: "empty",
        idleS: 9999,
        mark: "OPEN",
        tasksOpen: 0,
      }).slack,
    ).toBe(false);
  });

  it("long idle + BUSY mark without tasks still slack", () => {
    expect(
      classifySlack({
        agent: "claude",
        composer: "afk",
        idleS: 200,
        mark: "BUSY",
        tasksOpen: 0,
      }).slack,
    ).toBe(true);
  });
});

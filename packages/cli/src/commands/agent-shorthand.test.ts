import { describe, expect, it } from "vitest";
import { expandAgentShorthand, isAgentShorthand } from "./agent-shorthand.js";

describe("agent-shorthand", () => {
  it("expands ask/msg/tell to peer", () => {
    expect(expandAgentShorthand("ask", ["manager", "need", "help"]).argvRest).toEqual([
      "peer",
      "manager",
      "need",
      "help",
    ]);
    expect(expandAgentShorthand("msg", ["slot-1", "FYI: hi"]).argvRest[0]).toBe("peer");
    expect(expandAgentShorthand("tell", ["secretary", "ping"]).argvRest).toContain("secretary");
  });

  it("expands ackmsg to peer --ack", () => {
    expect(expandAgentShorthand("ackmsg", ["manager", "ACK done"]).argvRest).toEqual([
      "peer",
      "--ack",
      "manager",
      "ACK done",
    ]);
    expect(expandAgentShorthand("answered", ["slot-2", "ok"]).argvRest[1]).toBe("--ack");
  });

  it("expands reply to ack reply", () => {
    expect(expandAgentShorthand("reply", ["051b8b", "ACK"]).argvRest).toEqual([
      "ack",
      "reply",
      "051b8b",
      "ACK",
    ]);
  });

  it("recognizes shorthand verbs", () => {
    expect(isAgentShorthand("ask")).toBe(true);
    expect(isAgentShorthand("todo")).toBe(false);
  });
});

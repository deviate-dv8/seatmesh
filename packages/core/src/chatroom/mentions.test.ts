import { describe, expect, it } from "vitest";
import { parseMentionAgentIds } from "./mentions.js";

describe("parseMentionAgentIds", () => {
  it("parses worker, slot, mini mentions", () => {
    expect(parseMentionAgentIds("hey @worker-3 and @slot-6 see @mini-2")).toEqual([
      "worker-3",
      "worker-6",
      "mini-2",
    ]);
  });
});

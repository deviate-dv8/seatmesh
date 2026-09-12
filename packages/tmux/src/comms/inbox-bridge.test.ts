import { describe, expect, it } from "vitest";
import { inboxStatusArgv, parseInboxStatusFlags } from "./inbox-bridge.js";

describe("inbox status flags", () => {
  it("parses --wait with default duration", () => {
    expect(parseInboxStatusFlags(["--wait", "15", "--meta"])).toEqual({
      json: false,
      meta: true,
      waitSec: 15,
    });
  });

  it("defaults --wait to 30s when value missing", () => {
    expect(parseInboxStatusFlags(["--wait"]).waitSec).toBe(30);
  });

  it("strips status subcommand for flag parsing", () => {
    expect(inboxStatusArgv("status", ["--meta", "--json"])).toEqual(["--meta", "--json"]);
    expect(inboxStatusArgv(undefined, ["--wait", "5"])).toEqual(["--wait", "5"]);
    expect(inboxStatusArgv("list", [])).toEqual([]);
  });
});

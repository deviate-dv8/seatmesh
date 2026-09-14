import { describe, expect, it } from "vitest";
import { parseRemotePeerTarget } from "./remote-peer.js";

describe("parseRemotePeerTarget", () => {
  it("parses @alias:seat", () => {
    expect(parseRemotePeerTarget("@zsign:manager")).toEqual({
      alias: "zsign",
      seat: "manager",
    });
    expect(parseRemotePeerTarget("@dev:slot-1")).toEqual({
      alias: "dev",
      seat: "slot-1",
    });
  });

  it("returns null for local targets", () => {
    expect(parseRemotePeerTarget("manager")).toBeNull();
    expect(parseRemotePeerTarget("slot-1")).toBeNull();
  });
});

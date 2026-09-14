import { describe, expect, it } from "vitest";
import { callDestLabel, parseCallDest, peerRoomSlugAgents } from "./call-target.js";

describe("parseCallDest", () => {
  const opts = { workerCount: 4, miniMax: 4 };

  it("parses worker slot", () => {
    expect(parseCallDest("slot-2", opts)).toEqual({ tier: "worker", slot: 2 });
    expect(parseCallDest("3", opts)).toEqual({ tier: "worker", slot: 3 });
  });

  it("parses mini", () => {
    expect(parseCallDest("mini-1", opts)).toEqual({ tier: "mini", mini: 1 });
    expect(parseCallDest("manager-mini-2", opts)).toEqual({ tier: "mini", mini: 2 });
  });

  it("rejects out of range", () => {
    expect(() => parseCallDest("mini-9", opts)).toThrow(/outside/);
    expect(() => parseCallDest("9", opts)).toThrow(/usage/);
  });
});

describe("peerRoomSlugAgents", () => {
  it("sorts agent ids stably", () => {
    expect(peerRoomSlugAgents("worker-2", "mini-1", "abcd1234")).toBe(
      "peer-mini-1-worker-2-abcd1234",
    );
  });
});

describe("callDestLabel", () => {
  it("labels tiers", () => {
    expect(callDestLabel({ tier: "worker", slot: 1 })).toBe("slot-1");
    expect(callDestLabel({ tier: "mini", mini: 2 })).toBe("mini-2");
  });
});

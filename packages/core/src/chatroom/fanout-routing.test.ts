import { describe, expect, it } from "vitest";
import type { RoomProfile } from "./types.js";
import {
  buildGlobalRoomAudience,
  isAckOrNoise,
  resolveFanoutDelivery,
  rowLeadForMiniId,
} from "./fanout-routing.js";

const superviseProfile: RoomProfile = {
  slug: "supervise",
  kind: "contract",
  createdAt: "2026-09-12T00:00:00.000Z",
  createdBy: "test",
  members: [
    "mini-1",
    "mini-2",
    "mini-3",
    "mini-4",
    "mini-5",
    "mini-6",
    "mini-7",
    "mini-8",
  ],
  leads: ["mini-1", "mini-2"],
  leadWorkers: ["worker-5"],
  supervisor: "secretary",
};

const gridOpts = { miniGrid: "4x2", miniMax: 8, miniLeads: [1, 2] };

describe("rowLeadForMiniId", () => {
  it("mini-7 bottom row -> mini-2", () => {
    expect(rowLeadForMiniId("mini-7", "4x2", 8, [1, 2])).toBe("mini-2");
  });
  it("mini-4 top row -> mini-1", () => {
    expect(rowLeadForMiniId("mini-4", "4x2", 8, [1, 2])).toBe("mini-1");
  });
});

describe("resolveFanoutDelivery supervise hierarchy", () => {
  it("mini-7 TEST msg does NOT ping manager", () => {
    expect(
      resolveFanoutDelivery({
        targetId: "manager",
        from: "mini-7",
        kind: "msg",
        body: "TEST body for manager coord ping",
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("skip");
  });

  it("mini-7 TEST msg pings row lead mini-2 (rich or thin)", () => {
    const d = resolveFanoutDelivery({
      targetId: "mini-2",
      from: "mini-7",
      kind: "msg",
      body: "TEST body for manager coord ping",
      profile: superviseProfile,
      ...gridOpts,
    });
    expect(d).not.toBe("skip");
  });

  it("mini-7 CLAIMED does NOT ping manager directly", () => {
    expect(
      resolveFanoutDelivery({
        targetId: "manager",
        from: "mini-7",
        kind: "claim",
        body: "CLAIMED: D4-video firing now",
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("skip");
  });

  it("mini-7 DONE pings row lead mini-2 rich", () => {
    expect(
      resolveFanoutDelivery({
        targetId: "mini-2",
        from: "mini-7",
        kind: "done",
        body: "DONE: flow-preview PASS",
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("rich");
  });

  it("mini-1 full-gate FAIL (lead) pings manager rich", () => {
    expect(
      resolveFanoutDelivery({
        targetId: "manager",
        from: "mini-1",
        kind: "msg",
        body: "DONE mini-1 full-gate: FAIL 125/126",
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("rich");
  });

  it("mini-4 ACK noise skips manager and secretary", () => {
    const body =
      "mini-4 ACK: full-gate FAIL noted - standing by.";
    expect(isAckOrNoise(body, "msg")).toBe(true);
    expect(
      resolveFanoutDelivery({
        targetId: "manager",
        from: "mini-4",
        kind: "msg",
        body,
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("skip");
    expect(
      resolveFanoutDelivery({
        targetId: "secretary",
        from: "mini-4",
        kind: "msg",
        body,
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("skip");
  });

  it("cross-row lead mini-1 skips mini-7 bottom-row traffic", () => {
    expect(
      resolveFanoutDelivery({
        targetId: "mini-1",
        from: "mini-7",
        kind: "done",
        body: "DONE: flow-preview PASS",
        profile: superviseProfile,
        ...gridOpts,
      }),
    ).toBe("skip");
  });
});

describe("buildGlobalRoomAudience", () => {
  it("includes manager, secretary, minis — not workers", () => {
    const audience = buildGlobalRoomAudience(8);
    expect(audience.has("manager")).toBe(true);
    expect(audience.has("secretary")).toBe(true);
    expect(audience.has("mini-1")).toBe(true);
    expect(audience.has("mini-8")).toBe(true);
    expect(audience.has("worker-1")).toBe(false);
    expect(audience.has("worker-6")).toBe(false);
  });
});

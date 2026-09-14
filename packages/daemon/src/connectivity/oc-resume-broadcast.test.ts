import { describe, expect, it } from "vitest";
import { syncCarrierIpProbe } from "./oc-resume-broadcast.js";

describe("syncCarrierIpProbe", () => {
  it("returns string or null without throwing on bad port", () => {
    const ip = syncCarrierIpProbe("/tmp", 59999);
    expect(ip === null || typeof ip === "string").toBe(true);
  });
});

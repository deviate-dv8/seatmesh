import { describe, expect, it } from "vitest";
import { parseSeatTarget } from "./seat-paths.js";

describe("parseSeatTarget", () => {
  it("maps coord seats", () => {
    expect(parseSeatTarget("manager")).toEqual({ role: "manager" });
    expect(parseSeatTarget("manager-2")).toEqual({ role: "manager-2" });
    expect(parseSeatTarget("secretary")).toEqual({ role: "secretary" });
  });

  it("maps slot and mini", () => {
    expect(parseSeatTarget("slot-3")).toEqual({ role: "worker", slot: "3" });
    expect(parseSeatTarget("3")).toEqual({ role: "worker", slot: "3" });
    expect(parseSeatTarget("mini-2")).toEqual({ role: "manager-mini", mini: "2" });
    expect(parseSeatTarget("manager-mini-1")).toEqual({ role: "manager-mini", mini: "1" });
  });

  it("accepts any column id (profile names, not a closed enum)", () => {
    expect(parseSeatTarget("lead")).toEqual({ role: "lead" });
    expect(parseSeatTarget("lead-west")).toEqual({ role: "lead-west" });
    expect(parseSeatTarget("secretary-2")).toEqual({ role: "secretary-2" });
    expect(parseSeatTarget("manager2")).toEqual({ role: "manager-2" });
  });
});

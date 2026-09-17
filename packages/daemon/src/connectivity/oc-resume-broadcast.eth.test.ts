import { describe, expect, it } from "vitest";
import { isViaEth } from "./oc-resume-broadcast.js";

describe("isViaEth (oc-proxy eth fallback guard)", () => {
  it("treats via == eth as proxy-not-active (ignore eth as carrier)", () => {
    expect(isViaEth("138.84.114.16", "138.84.114.16")).toBe(true);
  });

  it("keeps a real carrier rotation when via differs from eth", () => {
    expect(isViaEth("175.176.84.90", "138.84.114.16")).toBe(false);
  });

  it("does not null out when eth is undetectable", () => {
    expect(isViaEth("175.176.84.90", null)).toBe(false);
    expect(isViaEth(null, "138.84.114.16")).toBe(false);
  });
});
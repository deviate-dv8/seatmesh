import { describe, expect, it } from "vitest";
import { formatCompactSeat, formatWorkerInjectStamp } from "./checkback-hint.js";

describe("formatCompactSeat", () => {
  it("labels manager coord pane", () => {
    expect(formatCompactSeat({ role: "manager" })).toBe("manager");
    expect(formatWorkerInjectStamp({ role: "manager" })).toBe("manager -");
  });
});

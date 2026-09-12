import { describe, expect, it } from "vitest";
import { effectiveManagerStack, stackIncludes } from "./stack.js";
import type { MeshLayout } from "../schema/layout.js";

const coldStart = {
  nvim: { window: "nvim", enabled: false },
  base: {
    window: "base",
    columns: ["manager", "secretary"],
    cli: { manager: "agent", secretary: "opencode" },
  },
  workers: { window: "workers", grid: "3x2", slots: 6, enabled: false },
  minis: { window: "minis", grid: "4x2", max: 8, leads: [1, 2], enabled: false },
} as unknown as MeshLayout;

describe("effectiveManagerStack", () => {
  it("is always manager only", () => {
    expect(effectiveManagerStack(coldStart)).toEqual(["manager"]);
    expect(stackIncludes(coldStart, "manager")).toBe(true);
    expect(stackIncludes(coldStart, "secretary")).toBe(false);
  });
});

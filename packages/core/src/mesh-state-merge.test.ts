import { describe, expect, it } from "vitest";
import { mergeMeshAgentsIntoProfile } from "./mesh-state-merge.js";
import type { MeshProfile } from "./schema/profile.js";

const baseProfile = {
  name: "test",
  workspace: ".",
  session: { name: "mesh", workerCount: 6, miniMax: 8 },
  layout: {
    nvim: { window: "nvim" },
    base: { window: "base", columns: ["manager", "secretary"] },
    workers: { window: "workers", grid: "3x2" as const, slots: 6 },
    minis: { window: "minis", grid: "4x2", max: 8, leads: [1, 2] },
  },
} as unknown as MeshProfile;

describe("mergeMeshAgentsIntoProfile", () => {
  it("overrides yaml minis layout when mesh-agents.json has layout.minis", () => {
    const merged = mergeMeshAgentsIntoProfile(baseProfile, {
      layout: { minis: { grid: "2x2", max: 4, leads: [1] } },
    });
    expect(merged.layout?.minis.grid).toBe("2x2");
    expect(merged.layout?.minis.max).toBe(4);
    expect(merged.layout?.minis.leads).toEqual([1]);
    expect(merged.session.miniMax).toBe(4);
  });

  it("returns profile unchanged when no saved layout", () => {
    const merged = mergeMeshAgentsIntoProfile(baseProfile, null);
    expect(merged.layout?.minis.grid).toBe("4x2");
    expect(merged.session.miniMax).toBe(8);
  });

  it("merges layout.base.coordSync from saved layout", () => {
    const merged = mergeMeshAgentsIntoProfile(baseProfile, {
      layout: { base: { coordSync: { reload: true, attach: false } } },
    });
    expect(merged.layout?.base.coordSync).toEqual({ reload: true, attach: false });
  });
});

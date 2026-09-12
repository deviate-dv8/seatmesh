import { describe, expect, it } from "vitest";
import { buildAgentCard, resolveGuardRole } from "./agent-card.js";
import type { WhoamiResult } from "./whoami.js";

function w(role: string, extras: Partial<WhoamiResult> = {}): WhoamiResult {
  return {
    inTmux: true,
    paneId: "%1",
    session: "mesh",
    window: "base",
    role,
    slot: null,
    slotLabel: null,
    ports: null,
    profile: "minimal",
    workspace: "/tmp",
    ...extras,
  };
}

describe("resolveGuardRole", () => {
  it("manager maps to manager seat kind", () => {
    const r = resolveGuardRole(w("manager"));
    expect(r.seatKind).toBe("manager");
    expect(r.guardRole).toBe("manager");
  });
});

describe("buildAgentCard", () => {
  it("manager can spawn minis", () => {
    const { can, cannot } = buildAgentCard(w("manager", { slotLabel: "manager" }));
    expect(can.some((c) => c.includes("mini spawn"))).toBe(true);
    expect(cannot.some((c) => c.includes("mini spawn"))).toBe(false);
  });
});

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

  it("unlabeled pane maps to plain (not worker fallback)", () => {
    const r = resolveGuardRole(w(""));
    expect(r.seatKind).toBe("plain");
    expect(r.guardRole).toBe("plain");
  });
});

describe("buildAgentCard", () => {
  it("manager can spawn minis", () => {
    const { can, cannot } = buildAgentCard(w("manager", { slotLabel: "manager" }));
    expect(can.some((c) => c.includes("mini spawn"))).toBe(true);
    expect(cannot.some((c) => c.includes("mini spawn"))).toBe(false);
  });

  it("every seat sees ack + peer + cb cancel (no guessing commands)", () => {
    const { can, lines } = buildAgentCard(w("secretary", { slotLabel: "secretary" }));
    expect(can.some((c) => /\back\b/.test(c))).toBe(true);
    expect(can.some((c) => c.includes("peer <target>"))).toBe(true);
    expect(can.some((c) => c.includes("cb cancel") || c.includes("cancel <id>"))).toBe(true);
    expect(can.every((c) => c.startsWith("seatmesh agent") || !c.includes("seatmesh"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("queued"))).toBe(true);
  });

  it("secretary cannot prompt workers", () => {
    const { cannot } = buildAgentCard(w("secretary"));
    expect(cannot.some((c) => c.includes("prompt <slot>"))).toBe(true);
  });
});

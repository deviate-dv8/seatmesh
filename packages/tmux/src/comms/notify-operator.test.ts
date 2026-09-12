import { describe, expect, it } from "vitest";
import type { WhoamiResult } from "../agents/whoami.js";
import { notifySeatDisplay, notifySlotArg } from "./notify-operator.js";

function who(partial: Partial<WhoamiResult> & Pick<WhoamiResult, "role">): WhoamiResult {
  return {
    inTmux: true,
    paneId: "%0",
    session: "mesh",
    window: "workers",
    slot: null,
    slotLabel: null,
    ports: null,
    profile: "zsign",
    workspace: "/tmp",
    ...partial,
  };
}

describe("notifySlotArg", () => {
  it("maps worker slot number", () => {
    expect(notifySlotArg(who({ role: "worker", slot: 3 }))).toBe("3");
  });

  it("maps manager roles", () => {
    expect(notifySlotArg(who({ role: "manager" }))).toBe("manager");
    expect(notifySlotArg(who({ role: "manager-2" }))).toBe("manager");
  });

  it("maps secretary", () => {
    expect(notifySlotArg(who({ role: "secretary" }))).toBe("secretary");
  });

  it("maps mini from role + mesh_mini", () => {
    expect(notifySlotArg(who({ role: "manager-mini" }), "5")).toBe("mini-5");
    expect(notifySlotArg(who({ role: "manager-mini", slotLabel: "mini-2" }))).toBe("mini-2");
  });
});

describe("notifySeatDisplay", () => {
  it("prefixes numeric worker slots", () => {
    expect(notifySeatDisplay("3")).toBe("slot-3");
  });

  it("passes through named seats", () => {
    expect(notifySeatDisplay("manager")).toBe("manager");
    expect(notifySeatDisplay("mini-2")).toBe("mini-2");
  });
});

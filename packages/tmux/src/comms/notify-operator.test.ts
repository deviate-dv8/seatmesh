import { describe, expect, it } from "vitest";
import type { WhoamiResult } from "../agents/whoami.js";
import {
  buildOperatorNotifyBody,
  buildOperatorNotifyTitle,
  desktopNotifyAvailable,
  notifySeatDisplay,
  notifySlotArg,
  runInboxDesktopNotifySync,
  shouldSkipDesktopNotify,
} from "./notify-operator.js";

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

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

describe("buildOperatorNotifyTitle", () => {
  it("joins seat and session like operator convention", () => {
    expect(buildOperatorNotifyTitle("slot-3", "Help clips")).toBe("slot-3 · Help clips");
  });
});

describe("buildOperatorNotifyBody", () => {
  it("adds Check line and optional url", () => {
    expect(buildOperatorNotifyBody("about", "eyeball UI", "http://localhost:5080")).toContain(
      "Check: eyeball UI",
    );
    expect(buildOperatorNotifyBody("about", "eyeball UI", "http://localhost:5080")).toContain(
      "http://localhost:5080",
    );
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

describe("shouldSkipDesktopNotify", () => {
  it("respects ZSIGN_SKIP_DESKTOP_NOTIFY", () => {
    const prev = process.env.ZSIGN_SKIP_DESKTOP_NOTIFY;
    process.env.ZSIGN_SKIP_DESKTOP_NOTIFY = "1";
    try {
      expect(shouldSkipDesktopNotify("/tmp")).toBe(true);
      expect(
        runInboxDesktopNotifySync("/tmp", {
          topic: "test",
          phase: "starting",
          sessionAbout: "about",
          check: "check",
        }),
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.ZSIGN_SKIP_DESKTOP_NOTIFY;
      else process.env.ZSIGN_SKIP_DESKTOP_NOTIFY = prev;
    }
  });
});

describe("desktopNotifyAvailable (cross-platform)", () => {
  it("win32 is always available (node-notifier bundles SnoreToast)", () => {
    expect(withPlatform("win32", () => desktopNotifyAvailable())).toBe(true);
  });

  it("darwin/linux depend on a real command being on PATH (env-dependent, just must not throw)", () => {
    expect(() => withPlatform("darwin", () => desktopNotifyAvailable())).not.toThrow();
    expect(() => withPlatform("linux", () => desktopNotifyAvailable())).not.toThrow();
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";

vi.mock("./whoami.js", () => ({
  runWhoami: vi.fn(),
}));

import { runWhoami } from "./whoami.js";
import { requireCoordRole, requireInboxLifecycleRole, requireRole } from "./authz-guard.js";

const loaded = {} as LoadedProfile;

describe("requireRole / requireCoordRole", () => {
  const originalExit = process.exit;
  const originalErr = console.error;

  afterEach(() => {
    process.exit = originalExit;
    console.error = originalErr;
    vi.restoreAllMocks();
  });

  function stubExit(): { errors: string[]; exitCode: () => number | undefined } {
    const errors: string[] = [];
    let code: number | undefined;
    console.error = (msg: string) => errors.push(msg);
    process.exit = (c?: number): never => {
      code = c;
      throw new Error("__exit__");
    };
    return { errors, exitCode: () => code };
  }

  it("allows a role that is in the allowed list (no exit)", () => {
    // @ts-expect-error partial mock
    vi.mocked(runWhoami).mockReturnValue({ role: "manager" });
    expect(() => requireRole(loaded, ["manager"], "mini spawn")).not.toThrow();
  });

  it("prints UNAUTHORIZED + exits 2 for a denied role", () => {
    // @ts-expect-error partial mock
    vi.mocked(runWhoami).mockReturnValue({ role: "worker" });
    const { errors, exitCode } = stubExit();
    expect(() => requireRole(loaded, ["manager"], "mini spawn")).toThrow("__exit__");
    expect(exitCode()).toBe(2);
    expect(errors[0]).toBe("UNAUTHORIZED: mini spawn requires role=manager (you_are=worker)");
    expect(errors[1]).toBe("hint: seatmesh --profile .sm agent");
  });

  it("requireCoordRole allows manager-2 and secretary, denies worker", () => {
    const prev = process.env.TMUX_PANE;
    process.env.TMUX_PANE = "%1";
    try {
      // @ts-expect-error partial mock
      vi.mocked(runWhoami).mockReturnValue({ role: "manager-2" });
      expect(() => requireCoordRole(loaded, "peer")).not.toThrow();

      // @ts-expect-error partial mock
      vi.mocked(runWhoami).mockReturnValue({ role: "secretary" });
      expect(() => requireCoordRole(loaded, "peer")).not.toThrow();

      // @ts-expect-error partial mock
      vi.mocked(runWhoami).mockReturnValue({ role: "worker" });
      const { errors } = stubExit();
      expect(() => requireCoordRole(loaded, "peer")).toThrow("__exit__");
      expect(errors[0]).toContain("UNAUTHORIZED: peer requires role=");
      expect(errors[0]).toContain("manager");
      expect(errors[0]).toContain("secretary");
      expect(errors[0]).toContain("you_are=worker");
    } finally {
      if (prev === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = prev;
    }
  });

  it("requireInboxLifecycleRole allows manager+secretary, denies manager-2", () => {
    const prev = process.env.TMUX_PANE;
    process.env.TMUX_PANE = "%1";
    try {
      // @ts-expect-error partial mock
      vi.mocked(runWhoami).mockReturnValue({ role: "manager" });
      expect(() => requireInboxLifecycleRole(loaded, "inbox restart")).not.toThrow();

      // @ts-expect-error partial mock
      vi.mocked(runWhoami).mockReturnValue({ role: "secretary" });
      expect(() => requireInboxLifecycleRole(loaded, "inbox restart")).not.toThrow();

      // @ts-expect-error partial mock
      vi.mocked(runWhoami).mockReturnValue({ role: "manager-2" });
      const { errors } = stubExit();
      expect(() => requireInboxLifecycleRole(loaded, "inbox restart")).toThrow("__exit__");
      expect(errors[0]).toContain("UNAUTHORIZED: inbox restart");
      expect(errors[0]).toContain("you_are=manager-2");
      expect(errors[1]).toContain("ask manager or secretary");
    } finally {
      if (prev === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = prev;
    }
  });

  it("requireInboxLifecycleRole allows cross-mesh TMUX_PANE (pane not in this profile)", () => {
    const prev = process.env.TMUX_PANE;
    process.env.TMUX_PANE = "%32";
    try {
      vi.mocked(runWhoami).mockImplementation(() => {
        throw new Error("pane %32 not found");
      });
      expect(() => requireInboxLifecycleRole(loaded, "inbox restart")).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.TMUX_PANE;
      else process.env.TMUX_PANE = prev;
    }
  });
});

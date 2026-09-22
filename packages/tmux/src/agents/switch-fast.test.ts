import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";

vi.mock("../lib/tmux-run.js", () => ({
  tmux: vi.fn((args: string[]) => {
    const joined = args.join(" ");
    if (joined.includes("pane_current_command")) return { ok: true, out: "zsh", err: "" };
    if (joined.includes("pane_input_off")) return { ok: true, out: "0", err: "" };
    if (joined.includes("session_name")) return { ok: true, out: "mesh-test", err: "" };
    return { ok: true, out: "", err: "" };
  }),
  tmuxHasSession: vi.fn(() => true),
}));

vi.mock("../lib/live-session.js", () => ({
  resolveLiveTmuxSession: vi.fn(() => "mesh-test"),
}));

vi.mock("../lib/resolve-pane.js", () => ({
  resolvePaneTarget: vi.fn(() => ({
    paneId: "%99",
    row: {
      paneId: "%99",
      session: "mesh-test",
      window: "workers",
      role: "worker",
      slot: "1",
      ports: "3010/3011",
      mini: "",
      workspaceId: "test",
    },
  })),
  assertPaneInLiveSession: vi.fn(),
}));

import { fastLaunchCmd, runSwitchFast } from "./switch-fast.js";
import { tmux } from "../lib/tmux-run.js";

const loaded = {
  sessionName: "mesh-test",
  workspace: "/tmp",
  workspaceId: "test",
  profile: {
    ports: { worker: "301{n}/301{n}" },
    layout: { base: { kinds: {} } },
  },
} as unknown as LoadedProfile;

describe("runSwitchFast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pastes launch without heavy switch path", () => {
    const t0 = Date.now();
    runSwitchFast(loaded, "slot-1", "opencode", { fresh: true });
    const ms = Date.now() - t0;
    const calls = vi.mocked(tmux).mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("paste-buffer") || c.includes("send-keys"))).toBe(true);
    expect(calls.some((c) => c.includes("@mesh_status"))).toBe(true);
    expect(ms).toBeLessThan(200);
  });

  it("empty on shell only stamps status (no respawn)", () => {
    runSwitchFast(loaded, "slot-1", "empty", { fresh: true });
    const calls = vi.mocked(tmux).mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("respawn-pane"))).toBe(false);
    expect(calls.some((c) => c.includes("@mesh_status"))).toBe(true);
  });

  it("empty on live CLI uses respawn-pane -k", () => {
    vi.mocked(tmux).mockImplementation((args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("pane_current_command")) return { ok: true, out: "agent", err: "" };
      if (joined.includes("pane_input_off")) return { ok: true, out: "0", err: "" };
      if (joined.includes("session_name")) return { ok: true, out: "mesh-test", err: "" };
      return { ok: true, out: "", err: "" };
    });
    runSwitchFast(loaded, "slot-1", "empty", { fresh: true });
    const calls = vi.mocked(tmux).mock.calls.map((c) => c[0].join(" "));
    expect(calls.some((c) => c.includes("respawn-pane") && c.includes("-k"))).toBe(true);
  });
});

describe("fastLaunchCmd", () => {
  // `env VAR=val cd ... && cmd` is broken — `env` execs its first bare arg as a
  // binary, and `cd` isn't one ("env: 'cd': No such file or directory"). `cd`
  // must run first (as a shell builtin), then `env` execs the real CLI.
  it("puts cd before the env prefix for opencode (fresh)", () => {
    const cmd = fastLaunchCmd("opencode", "/home/dan/Desktop/Work/zsign");
    expect(cmd).toMatch(/^cd .*&& env /);
    expect(cmd).not.toMatch(/env .*\bcd\b/);
  });

  it("puts cd before the env prefix for opencode (resume)", () => {
    const cmd = fastLaunchCmd("opencode", "/tmp/work", "ses_abc123");
    expect(cmd).toMatch(/^cd .*&& env /);
    expect(cmd).toContain("--session ses_abc123");
  });

  it("puts cd before the env prefix for opencode-cpe", () => {
    const cmd = fastLaunchCmd("opencode-cpe", "/tmp/work");
    expect(cmd).toMatch(/^cd .*&& env /);
    expect(cmd).not.toMatch(/env .*\bcd\b/);
  });
});

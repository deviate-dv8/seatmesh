import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedProfile, MeshAgents, ResolvedAgentKind } from "@seat-mesh/core";
import { MeshAgentsSchema } from "@seat-mesh/core";
import { resolveKindsForProfile } from "@seat-mesh/providers";
import {
  assertSaveAllowed,
  buildSavedResumeCmd,
  detectPaneType,
  formatSaveSummary,
  isOpenCodeCpeKind,
  saveMeshAgentsFile,
} from "./save-session.js";

// Real resolved kinds (provider kindBase, not hand-typed fixtures) — same shape
// production actually sees, so these tests can't silently drift from reality.
const REAL_KINDS: Record<string, ResolvedAgentKind> = resolveKindsForProfile({
  providers: ["opencode", "empty"],
  agents: { runners: {}, kinds: {} },
});

const CPE_RESUME_CMD =
  "cd /w && env -u NO_COLOR COLORTERM=truecolor 'scripts/opencode-cpe.sh' --session ses_old";
const PLAIN_OC_RESUME_CMD = "env -u NO_COLOR COLORTERM=truecolor opencode --auto --session ses_old";

function sampleAgents(): MeshAgents {
  return {
    schemaVersion: 1,
    session: "mesh-abc",
    workdir: "/tmp/ws",
    manager: { type: "agent", resumeId: "mgr-1" },
    coords: { "lead-west": { type: "claude", resumeId: "lead-1" } },
    secretary: { type: "opencode", wanted: true, resumeId: "ses_sec" },
    workers: [
      { slot: 1, type: "agent", resumeId: "w1" },
      { slot: 2, type: "empty", resumeId: null },
    ],
    minis: [{ mini: 1, type: "opencode", role: "tester", resumeId: "m1" }],
    layout: { minis: { enabled: true, grid: "4x2", max: 8, leads: [1, 2] } },
    conventions: {
      secretaryDefaultCli: "opencode",
      miniDefaultCli: "opencode",
      launchSkipsEmpty: true,
    },
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

describe("formatSaveSummary", () => {
  it("prints harness-style slot summary", () => {
    const out = formatSaveSummary(sampleAgents(), "/tmp/ws/.sm/mesh-agents.json");
    expect(out).toContain("--- summary ---");
    expect(out).toContain("session: mesh-abc");
    expect(out).toContain("manager: agent resume");
    expect(out).toContain("lead-west: claude resume");
    expect(out).toContain("secretary: wanted=true type=opencode resume");
    expect(out).toContain("slot 1: agent resume");
    expect(out).toContain("slot 2: empty");
    expect(out).toContain("mini 1: opencode role=tester resume");
    expect(out).toContain("layout.minis: 4x2 max=8 leads=[1,2]");
    expect(out).toContain("full JSON: /tmp/ws/.sm/mesh-agents.json");
  });
});

describe("assertSaveAllowed", () => {
  it("allows outside tmux", () => {
    const prev = process.env.TMUX_PANE;
    delete process.env.TMUX_PANE;
    const loaded = {
      sessionName: "mesh-x",
      workspace: "/tmp",
      profile: { layout: { minis: { window: "minis" } } },
    } as LoadedProfile;
    expect(() => assertSaveAllowed(loaded)).not.toThrow();
    if (prev) process.env.TMUX_PANE = prev;
  });
});

describe("saveMeshAgentsFile", () => {
  it("writes atomically and round-trips coord columns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-agents-"));
    const file = saveMeshAgentsFile(path.join(dir, ".sm", "mesh-agents.json"), sampleAgents());
    expect(fs.existsSync(file)).toBe(true);
    const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    const parsed = MeshAgentsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(parsed.coords?.["lead-west"]?.type).toBe("claude");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// TODO 6.4 — pruning the isOpenCodeCpeResumeCmd/buildCustomKindLaunchCmd
// dual-path special-case. These prove the generic prove-pattern path (kinds
// present) and the legacy regex fallback (kinds absent) agree on every case
// that mattered before the prune, especially the "stale type field, correct
// resumeCmd" case that's the whole reason this dual-checking existed.
describe("isOpenCodeCpeKind (TODO 6.4)", () => {
  it("type === opencode-cpe is true with or without kinds", () => {
    expect(isOpenCodeCpeKind("opencode-cpe", undefined, REAL_KINDS)).toBe(true);
    expect(isOpenCodeCpeKind("opencode-cpe", undefined, undefined)).toBe(true);
  });

  it("preserved.type === opencode-cpe is true with or without kinds", () => {
    const preserved = { type: "opencode-cpe" as const };
    expect(isOpenCodeCpeKind(undefined, preserved, REAL_KINDS)).toBe(true);
    expect(isOpenCodeCpeKind(undefined, preserved, undefined)).toBe(true);
  });

  it("stale type but a CPE resumeCmd is still detected — with kinds (generic prove path)", () => {
    const preserved = { type: "opencode" as const, resumeCmd: CPE_RESUME_CMD };
    expect(isOpenCodeCpeKind("opencode", preserved, REAL_KINDS)).toBe(true);
  });

  it("stale type but a CPE resumeCmd is still detected — without kinds (legacy fallback)", () => {
    const preserved = { type: "opencode" as const, resumeCmd: CPE_RESUME_CMD };
    expect(isOpenCodeCpeKind("opencode", preserved, undefined)).toBe(true);
  });

  it("a plain (non-CPE) opencode resumeCmd is not CPE, with or without kinds", () => {
    const preserved = { type: "opencode" as const, resumeCmd: PLAIN_OC_RESUME_CMD };
    expect(isOpenCodeCpeKind("opencode", preserved, REAL_KINDS)).toBe(false);
    expect(isOpenCodeCpeKind("opencode", preserved, undefined)).toBe(false);
  });

  it("nothing indicates CPE -> false", () => {
    expect(isOpenCodeCpeKind("claude", { type: "claude" }, REAL_KINDS)).toBe(false);
  });
});

describe("buildSavedResumeCmd (TODO 6.4)", () => {
  it("refreshes --session on a preserved CPE wrapper — with kinds (generic path)", () => {
    const cmd = buildSavedResumeCmd(
      "opencode-cpe",
      "/w",
      "ses_new",
      {},
      { resumeCmd: CPE_RESUME_CMD },
      REAL_KINDS,
    );
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_new");
    expect(cmd).not.toContain("ses_old");
  });

  it("refreshes --session on a preserved CPE wrapper — without kinds (legacy fallback, previously the only path)", () => {
    const cmd = buildSavedResumeCmd(
      "opencode-cpe",
      "/w",
      "ses_new",
      {},
      { resumeCmd: CPE_RESUME_CMD },
      undefined,
    );
    expect(cmd).toContain("opencode-cpe.sh");
    expect(cmd).toContain("--session ses_new");
    expect(cmd).not.toContain("ses_old");
  });

  it("does not treat a plain opencode resumeCmd as a CPE wrapper to preserve", () => {
    const cmd = buildSavedResumeCmd(
      "opencode",
      "/w",
      "ses_new",
      {},
      { resumeCmd: PLAIN_OC_RESUME_CMD },
      REAL_KINDS,
    );
    // Falls through to a fresh build, not the preserved-wrapper refresh path.
    expect(cmd).not.toBe(PLAIN_OC_RESUME_CMD.replace("ses_old", "ses_new"));
  });
});

describe("detectPaneType (TODO 6.4)", () => {
  function snap(processCmdlines: string) {
    return {
      paneId: "%1",
      windowName: "workers",
      cwd: "/w",
      currentCommand: "opencode",
      captureTail: "",
      options: { processCmdlines },
    } as unknown as Parameters<typeof detectPaneType>[0];
  }

  it("live cmdline shows opencode-cpe.sh -> opencode-cpe", () => {
    expect(detectPaneType(snap(CPE_RESUME_CMD), "opencode", undefined, REAL_KINDS)).toBe(
      "opencode-cpe",
    );
  });

  it("preserved.type === opencode-cpe -> opencode-cpe regardless of live cmdline", () => {
    expect(
      detectPaneType(snap(PLAIN_OC_RESUME_CMD), "opencode", { type: "opencode-cpe" }, REAL_KINDS),
    ).toBe("opencode-cpe");
  });

  it("stale preserved.type but a CPE preserved.resumeCmd — with kinds (generic prove path)", () => {
    const preserved = { type: "opencode" as const, resumeCmd: CPE_RESUME_CMD };
    expect(detectPaneType(snap(PLAIN_OC_RESUME_CMD), "opencode", preserved, REAL_KINDS)).toBe(
      "opencode-cpe",
    );
  });

  it("stale preserved.type but a CPE preserved.resumeCmd — without kinds (legacy fallback)", () => {
    const preserved = { type: "opencode" as const, resumeCmd: CPE_RESUME_CMD };
    expect(detectPaneType(snap(PLAIN_OC_RESUME_CMD), "opencode", preserved, undefined)).toBe(
      "opencode-cpe",
    );
  });

  it("a plain opencode pane with no CPE signal anywhere stays opencode", () => {
    const preserved = { type: "opencode" as const, resumeCmd: PLAIN_OC_RESUME_CMD };
    expect(detectPaneType(snap(PLAIN_OC_RESUME_CMD), "opencode", preserved, REAL_KINDS)).toBe(
      "opencode",
    );
  });
});

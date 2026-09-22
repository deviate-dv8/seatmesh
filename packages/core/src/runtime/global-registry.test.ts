import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("global-registry (session-kill: label matching)", () => {
  let tmp = "";
  let prevXdg: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "global-registry-"));
    prevXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmp;
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function seedRegistry() {
    const dir = path.join(tmp, "seatmesh");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "sessions.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "abc123",
            label: "myproj",
            profilePath: "/work/myproj/.sm/mesh.config.yaml",
            workspace: "/work/myproj",
            workspaceId: "abc123",
            sessionName: "mesh-abc123",
            daemonPort: 31680,
            lastSeen: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
  }

  it("findGlobalSession matches by label (the field the sidebar/hub actually show)", async () => {
    seedRegistry();
    const { readGlobalRegistry, findGlobalSession } = await import("./global-registry.js");
    const reg = readGlobalRegistry();
    expect(findGlobalSession(reg, "myproj")?.id).toBe("abc123");
  });

  it("findGlobalSession still matches by id/sessionName/workspace (unchanged)", async () => {
    seedRegistry();
    const { readGlobalRegistry, findGlobalSession } = await import("./global-registry.js");
    const reg = readGlobalRegistry();
    expect(findGlobalSession(reg, "abc123")?.label).toBe("myproj");
    expect(findGlobalSession(reg, "mesh-abc123")?.label).toBe("myproj");
    expect(findGlobalSession(reg, "/work/myproj")?.label).toBe("myproj");
  });

  it("findGlobalSession returns undefined for no match", async () => {
    seedRegistry();
    const { readGlobalRegistry, findGlobalSession } = await import("./global-registry.js");
    expect(findGlobalSession(readGlobalRegistry(), "nope")).toBeUndefined();
  });

  it("forgetGlobalSession removes by label too (was id/profilePath/workspace only)", async () => {
    seedRegistry();
    const { forgetGlobalSession, readGlobalRegistry } = await import("./global-registry.js");
    const removed = await forgetGlobalSession("myproj");
    expect(removed).toBe(true);
    expect(readGlobalRegistry().sessions).toHaveLength(0);
  });

  it("forgetGlobalSession removes by sessionName too (was missing before)", async () => {
    seedRegistry();
    const { forgetGlobalSession, readGlobalRegistry } = await import("./global-registry.js");
    const removed = await forgetGlobalSession("mesh-abc123");
    expect(removed).toBe(true);
    expect(readGlobalRegistry().sessions).toHaveLength(0);
  });

  it("forgetGlobalSession returns false for no match, leaves registry untouched", async () => {
    seedRegistry();
    const { forgetGlobalSession, readGlobalRegistry } = await import("./global-registry.js");
    const removed = await forgetGlobalSession("nope");
    expect(removed).toBe(false);
    expect(readGlobalRegistry().sessions).toHaveLength(1);
  });
});

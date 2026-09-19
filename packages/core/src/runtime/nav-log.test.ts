import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedProfile } from "../profile/profile.js";
import type { MeshProfile } from "../schema/profile.js";
import { workspaceScopeId, resolveSessionName } from "../paths/runtime-paths.js";
import { appendNavEntry, summarizeNavEntries, tailNavLog } from "./nav-log.js";

function stubProfile(): MeshProfile {
  return {
    name: "test",
    workspace: ".",
    session: { name: "mesh", scope: "workspace", idLength: 6, workerCount: 4, miniMax: 4 },
    seats: { root: "seats", templates: ["FOCUS"], dirs: {} as MeshProfile["seats"]["dirs"] },
    state: { agentsJson: "a.json", meshAgentsJson: "m.json" },
    roles: { dir: "roles" },
    providers: ["empty"],
  } as MeshProfile;
}

function stubLoaded(workspace: string): LoadedProfile {
  const profile = stubProfile();
  return {
    profile,
    profileDir: path.join(workspace, ".sm"),
    profilePath: path.join(workspace, ".sm", "mesh.config.yaml"),
    workspace,
    workspaceId: workspaceScopeId(workspace),
    sessionName: resolveSessionName(profile, workspace),
  };
}

describe("nav-log", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("appends and tails entries", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nav-log-"));
    const loaded = stubLoaded(tmp);
    await appendNavEntry(loaded, {
      actor: "operator",
      target: "slot-1",
      targetPane: "%3",
      role: "worker",
      slot: "1",
    });
    await appendNavEntry(loaded, { actor: "agent", target: "manager", targetPane: "%1" });
    const entries = await tailNavLog(loaded, 10);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.target).toBe("slot-1");
    expect(entries[0]?.role).toBe("worker");
    expect(entries[1]?.target).toBe("manager");
    expect(entries[1]?.role).toBeUndefined();
  });

  it("tailNavLog returns [] when nothing was ever appended", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nav-log-empty-"));
    const loaded = stubLoaded(tmp);
    expect(await tailNavLog(loaded, 10)).toEqual([]);
  });
});

describe("summarizeNavEntries", () => {
  it("groups by target, counts visits, keeps the latest lastAt, sorted most-recent-first", () => {
    const rows = summarizeNavEntries([
      { at: "2026-09-19T00:00:00.000Z", actor: "operator", target: "slot-1", targetPane: "%3" },
      { at: "2026-09-19T00:05:00.000Z", actor: "operator", target: "manager", targetPane: "%1" },
      { at: "2026-09-19T00:10:00.000Z", actor: "operator", target: "slot-1", targetPane: "%3" },
    ]);
    expect(rows).toEqual([
      { target: "slot-1", count: 2, lastAt: "2026-09-19T00:10:00.000Z" },
      { target: "manager", count: 1, lastAt: "2026-09-19T00:05:00.000Z" },
    ]);
  });

  it("empty input -> empty output", () => {
    expect(summarizeNavEntries([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  meshRuntimePaths,
  resolveDaemonPort,
  resolveSessionName,
  workspaceScopeId,
} from "./runtime-paths.js";
import type { LoadedProfile } from "../profile/profile.js";
import type { MeshProfile } from "../schema/profile.js";

function stubProfile(overrides: Partial<MeshProfile> = {}): MeshProfile {
  return {
    name: "test",
    workspace: ".",
    session: {
      name: "mesh",
      scope: "workspace",
      idLength: 6,
      workerCount: 4,
      miniMax: 4,
    },
    seats: { root: "seats", templates: ["FOCUS"], dirs: {} as MeshProfile["seats"]["dirs"] },
    state: { agentsJson: "a.json", meshAgentsJson: "m.json" },
    roles: { dir: "roles" },
    providers: ["empty"],
    ...overrides,
  } as MeshProfile;
}

function stubLoaded(workspace: string, profile = stubProfile()): LoadedProfile {
  const workspaceId = workspaceScopeId(workspace);
  return {
    profile,
    profileDir: "/tmp/profile",
    profilePath: "/tmp/profile/mesh.config.yaml",
    workspace,
    workspaceId,
    sessionName: resolveSessionName(profile, workspace),
  };
}

describe("workspaceScopeId", () => {
  it("is stable for the same path", () => {
    const ws = "/tmp/my-project";
    expect(workspaceScopeId(ws)).toBe(workspaceScopeId(ws));
  });

  it("differs across projects", () => {
    expect(workspaceScopeId("/tmp/a")).not.toBe(workspaceScopeId("/tmp/b"));
  });
});

describe("resolveSessionName", () => {
  it("suffixes workspace hash by default", () => {
    const ws = "/tmp/my-project";
    const name = resolveSessionName(stubProfile(), ws);
    expect(name).toMatch(/^mesh-[a-f0-9]{6}$/);
    expect(name).toBe(`mesh-${workspaceScopeId(ws)}`);
  });

  it("returns base name when scope global", () => {
    const p = stubProfile({ session: { ...stubProfile().session, scope: "global" } });
    expect(resolveSessionName(p, "/tmp/x")).toBe("mesh");
  });
});

describe("resolveDaemonPort", () => {
  it("offsets port per workspace by default", () => {
    const p = stubProfile();
    const portA = resolveDaemonPort(p, "/tmp/project-a");
    const portB = resolveDaemonPort(p, "/tmp/project-b");
    expect(portA).toBeGreaterThanOrEqual(31670);
    expect(portA).toBeLessThan(31670 + 90);
    expect(portA).not.toBe(portB);
  });

  it("uses fixed port when portScope profile", () => {
    const p = stubProfile({
      daemon: { port: 3200, portScope: "profile" },
    } as Partial<MeshProfile>);
    expect(resolveDaemonPort(p, "/tmp/a")).toBe(3200);
    expect(resolveDaemonPort(p, "/tmp/b")).toBe(3200);
  });
});

describe("meshRuntimePaths", () => {
  it("places daemon under profileDir data.root when scope=profile", () => {
    const profile = stubProfile({
      paths: { scope: "profile" },
      data: { root: "runtime" },
    });
    const loaded = stubLoaded("/tmp/ws", profile);
    loaded.profileDir = "/tmp/profile";
    const rt = meshRuntimePaths(loaded);
    expect(rt.daemonDir).toBe(path.join("/tmp/profile", "runtime", "daemon"));
    expect(rt.sqlitePath).toBe(path.join("/tmp/profile", "runtime", "mesh.sqlite"));
    expect(rt.storageBackend).toBe("sqlite");
    expect(rt.minisJson).toBe(path.join("/tmp/profile", "runtime", "minis.json"));
  });
});

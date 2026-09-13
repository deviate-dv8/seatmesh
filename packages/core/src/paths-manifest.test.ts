import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildResolvedPaths,
  PATHS_MANIFEST,
  resolveHarnessPath,
  writePathsManifest,
} from "./paths-manifest.js";
import type { LoadedProfile } from "./profile.js";
import type { MeshProfile } from "./schema/profile.js";

function stubLoaded(profileDir: string, workspace: string): LoadedProfile {
  const profile = {
    name: "ci",
    workspace: "..",
    paths: { scope: "profile" as const },
    storage: { backend: "sqlite" as const, sqlite: { path: "runtime/mesh.sqlite" } },
    session: {
      name: "mesh",
      scope: "workspace" as const,
      idLength: 6,
      workerCount: 4,
      miniMax: 4,
    },
    seats: { root: "seats", templates: ["FOCUS"], dirs: {} },
    state: { agentsJson: "tmux-main-agents.json", meshAgentsJson: "mesh-agents.json" },
    roles: { dir: "roles" },
    data: { root: "runtime" },
    providers: ["empty"],
  } as MeshProfile;
  return {
    profile,
    profileDir,
    profilePath: path.join(profileDir, "mesh.config.yaml"),
    workspace,
    workspaceId: "abc123",
    sessionName: "mesh-abc123",
  };
}

describe("paths-manifest", () => {
  it("resolves harness paths under profileDir", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sm-paths-"));
    const sm = path.join(ws, ".sm");
    fs.mkdirSync(sm, { recursive: true });
    const loaded = stubLoaded(sm, ws);
    const p = buildResolvedPaths(loaded);
    expect(p.daemonDir).toBe(path.join(sm, "runtime", "daemon"));
    expect(p.sqlitePath).toBe(path.join(sm, "runtime", "mesh.sqlite"));
    expect(p.chatRoomsRoot).toBe(path.join(sm, "chat-rooms"));
    expect(p.meshAgentsJson).toBe(path.join(sm, "mesh-agents.json"));
    expect(resolveHarnessPath(loaded, "seats")).toBe(path.join(sm, "seats"));
  });

  it("writes paths.json", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sm-paths-"));
    const sm = path.join(ws, ".sm");
    fs.mkdirSync(sm, { recursive: true });
    const loaded = stubLoaded(sm, ws);
    const out = writePathsManifest(loaded);
    expect(out).toBe(path.join(sm, PATHS_MANIFEST));
    const doc = JSON.parse(fs.readFileSync(out, "utf8")) as { pathsScope: string };
    expect(doc.pathsScope).toBe("profile");
  });
});

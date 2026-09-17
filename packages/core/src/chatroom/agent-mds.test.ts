import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MeshProfileSchema } from "../schema/profile.js";
import {
  resolveSessionName,
  workspaceScopeId,
  type LoadedProfile,
} from "../profile/profile.js";
import {
  hostMarkdownIntoSm,
  listAgentKindMds,
  listAgentSelfMds,
  listHostedMds,
  parseAgentMdKind,
  readAgentKindMd,
} from "./agent-mds.js";

function testLoaded(workspace: string): LoadedProfile {
  const profileDir = path.join(workspace, ".sm");
  fs.mkdirSync(path.join(profileDir, "mds"), { recursive: true });
  fs.mkdirSync(path.join(profileDir, "seats", "manager"), { recursive: true });
  fs.mkdirSync(path.join(profileDir, "seats", "_shared"), { recursive: true });
  fs.mkdirSync(path.join(profileDir, "roles", "_vendor", "docs"), { recursive: true });
  fs.writeFileSync(path.join(profileDir, "seats", "manager", "FOCUS.md"), "# Focus\n");
  fs.writeFileSync(path.join(profileDir, "seats", "_shared", "NOTES.md"), "# Notes\n");
  fs.writeFileSync(path.join(profileDir, "roles", "_vendor", "docs", "manager.md"), "# Mgr\n");

  const profile = MeshProfileSchema.parse({
    name: "test",
    workspace: ".",
    session: { name: "mesh" },
    seats: { root: "seats" },
    state: { meshAgentsJson: "mesh-agents.json" },
    roles: { dir: "roles" },
  });
  return {
    profile,
    profileDir,
    profilePath: path.join(profileDir, "mesh.config.yaml"),
    workspace,
    workspaceId: workspaceScopeId(workspace),
    sessionName: resolveSessionName(profile, workspace),
  };
}

describe("agent-mds galleries", () => {
  let workspace = "";
  afterEach(() => {
    if (workspace && fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("lists agent-self FOCUS + _shared", () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-mds-"));
    const loaded = testLoaded(workspace);
    const rows = listAgentSelfMds(loaded, "manager");
    expect(rows.some((r) => r.id === "FOCUS.md")).toBe(true);
    expect(rows.some((r) => r.id === "_shared/NOTES.md")).toBe(true);
  });

  it("lists agent kind manager", () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-mds-"));
    const loaded = testLoaded(workspace);
    expect(parseAgentMdKind("manager")).toBe("manager");
    expect(listAgentKindMds(loaded).map((r) => r.id)).toContain("manager");
    expect(readAgentKindMd(loaded, "manager")?.title).toBe("Mgr");
  });

  it("hosts markdown into .sm/mds", () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-mds-"));
    const loaded = testLoaded(workspace);
    const src = path.join(workspace, "handout.md");
    fs.writeFileSync(src, "# Handout\nhello\n");
    const { slug } = hostMarkdownIntoSm(loaded, src);
    expect(slug).toBe("handout");
    expect(listHostedMds(loaded).some((i) => i.slug === "handout")).toBe(true);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedProfile, MeshProfile } from "@seat-mesh/core";
import {
  formatAgentContextReport,
  validateAllRoleIndexes,
  type AgentContextReport,
} from "./agent-context.js";

function stubLoaded(profileDir: string, workspace: string): LoadedProfile {
  const profile = {
    name: "ci",
    workspace: "..",
    ports: { worker: "30{n}0/30{n}1" },
    paths: { scope: "profile" as const },
    storage: { backend: "sqlite" as const, sqlite: { path: "runtime/mesh.sqlite" } },
    session: {
      name: "mesh",
      scope: "workspace" as const,
      idLength: 6,
      workerCount: 4,
      miniMax: 4,
    },
    seats: { root: "seats", templates: ["FOCUS"], dirs: { worker: "slot-{n}" } },
    state: { agentsJson: "tmux-main-agents.json", meshAgentsJson: "mesh-agents.json" },
    roles: { dir: "roles" },
    data: { root: "runtime" },
    providers: ["empty"],
  } as unknown as MeshProfile;
  return {
    profile,
    profileDir,
    profilePath: path.join(profileDir, "mesh.config.yaml"),
    workspace,
    workspaceId: "abc123",
    sessionName: "mesh-abc123",
  };
}

describe("formatAgentContextReport", () => {
  it("lists read_first, files, and missing", () => {
    const report: AgentContextReport = {
      role: "manager-mini",
      kind: "mini",
      slotLabel: "mini-7",
      readFirst: [{ path: "docs/a.md", note: "one path", missing: false }],
      files: [{ path: "docs/b.md", missing: true }],
      missing: ["docs/b.md"],
      ok: false,
    };
    const text = formatAgentContextReport(report).join("\n");
    expect(text).toContain("role=mini slot=mini-7");
    expect(text).toContain("docs/a.md | one path");
    expect(text).toContain("docs/b.md MISSING");
    expect(text).toContain("--- missing (fix dotdir) ---");
    expect(text).toContain("  docs/b.md");
  });
});

describe("validateAllRoleIndexes", () => {
  it("flags missing paths per role yaml", () => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-ctx-"));
    const workspace = profileDir;
    const rolesDir = path.join(profileDir, "roles");
    fs.mkdirSync(rolesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rolesDir, "worker.yaml"),
      `kind: worker\nread_first:\n  - path: gone.md\n`,
    );

    const result = validateAllRoleIndexes(stubLoaded(profileDir, workspace));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.kind === "worker" && f.missing.includes("gone.md"))).toBe(
      true,
    );
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";
import type { MeshProfile } from "@seat-mesh/core";
import { buildSlotAdviceReport } from "./slot-advice.js";

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

describe("buildSlotAdviceReport", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("flags shared DB when FOCUS mentions migration", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-advice-"));
    const sm = path.join(tmp, ".sm");
    const seats = path.join(sm, "seats", "slot-1");
    fs.mkdirSync(seats, { recursive: true });
    fs.mkdirSync(path.join(tmp, "zsign-api", "feature", "1-my-feat"), { recursive: true });
    fs.writeFileSync(
      path.join(seats, "FOCUS.md"),
      "hub: run destructive migration on departments\n",
      "utf8",
    );

    const loaded = stubLoaded(sm, tmp);
    const report = buildSlotAdviceReport(loaded, 1);
    expect(report).toContain("RISK");
    expect(report).toContain("SHARED DB");
    expect(report).toContain("1-my-feat");
  });
});

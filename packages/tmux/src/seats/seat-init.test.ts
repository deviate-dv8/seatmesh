import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoadedProfile } from "@seat-mesh/core";
import { runSeatInit } from "./seat-init.js";
import { sharedSeatsDir } from "./seat-paths.js";

function tmpLoaded(): LoadedProfile {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-shared-"));
  return {
    workspace,
    profileDir: workspace,
    profilePath: path.join(workspace, "mesh.config.yaml"),
    profile: {
      name: "test",
      workspace: ".",
      session: { name: "mesh", workerCount: 1, miniMax: 1 },
      seats: {
        root: "seats",
        templates: ["FOCUS", "TASKS", "REMINDER"],
        dirs: {
          manager: "manager",
          secretary: "secretary",
          worker: "slot-{n}",
          mini: "mini-{n}",
        },
      },
      layout: { base: { columns: ["manager", "secretary"] } },
      state: { agentsJson: "a.json", meshAgentsJson: "m.json" },
      daemon: { port: 3100, managerPromptPrefix: "[mgr]" },
      providers: ["opencode"],
      roles: { dir: "roles" },
    },
  } as unknown as LoadedProfile;
}

describe("runSeatInit _shared", () => {
  it("creates _shared README + NOTES once and does not overwrite", () => {
    const loaded = tmpLoaded();
    const shared = sharedSeatsDir(loaded);
    const first = runSeatInit(loaded);
    expect(first.ensured).toContain(shared);
    expect(fs.existsSync(path.join(shared, "NOTES.md"))).toBe(true);
    expect(fs.existsSync(path.join(shared, "README.md"))).toBe(true);
    expect(first.created.some((p) => p.includes("_shared"))).toBe(true);

    const notes = path.join(shared, "NOTES.md");
    fs.writeFileSync(notes, "# custom live notes\n");
    const second = runSeatInit(loaded);
    expect(fs.readFileSync(notes, "utf8")).toBe("# custom live notes\n");
    expect(second.created.some((p) => p.endsWith("NOTES.md"))).toBe(false);
  });
});

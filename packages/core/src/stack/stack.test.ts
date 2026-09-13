import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProfile } from "../profile/profile.js";
import {
  resolveSessionName,
  workspaceScopeId,
  type LoadedProfile,
} from "../profile/profile.js";
import { stackConfig } from "./config.js";
import { resolveStackScript } from "./exec.js";

describe("stackConfig", () => {
  const minimalDir = path.resolve(import.meta.dirname, "../../../../profiles/minimal");

  it("defaults to ./dc.sh", () => {
    const { profile } = loadProfile(minimalDir);
    expect(stackConfig(profile).command).toBe("./dc.sh");
  });

  it("reads profile stack override", () => {
    expect(
      stackConfig({
        name: "t",
        workspace: ".",
        stack: { command: "./zhr_dc.sh", summary: "zhr sibling stack" },
      } as import("../schema/profile.js").MeshProfile).summary,
    ).toBe("zhr sibling stack");
  });
});

describe("resolveStackScript", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });

  it("resolves workspace-relative command", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stack-exec-"));
    const script = path.join(tmp, "dc.sh");
    fs.writeFileSync(script, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    fs.chmodSync(script, 0o755);

    const profile = {
      name: "t",
      workspace: ".",
      session: { name: "mesh" },
      seats: { root: "tasks/agent-seats" },
      state: { meshAgentsJson: "mesh-agents.json" },
      roles: { dir: "roles" },
      stack: { command: "./dc.sh" },
    } as import("../schema/profile.js").MeshProfile;
    const loaded: LoadedProfile = {
      profile,
      profileDir: tmp,
      profilePath: path.join(tmp, "mesh.config.yaml"),
      workspace: tmp,
      workspaceId: workspaceScopeId(tmp),
      sessionName: resolveSessionName(profile, tmp),
    };
    expect(resolveStackScript(loaded)).toBe(script);
  });
});

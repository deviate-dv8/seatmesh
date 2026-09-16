import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  applyProfileFormPatch,
  profileToFormValues,
  writeProfileFormPatch,
} from "./profile-write.js";

describe("profile-write", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("applies form patch and validates round-trip", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-pw-"));
    const profilePath = path.join(tmp, "mesh.config.yaml");
    fs.writeFileSync(
      profilePath,
      [
        "name: demo",
        "workspace: ..",
        "session:",
        "  name: mesh",
        "  workerCount: 2",
        "  miniMax: 2",
        "layout:",
        "  base:",
        "    window: base",
        "    columns: [manager, secretary]",
        "  workers:",
        "    window: workers",
        "    grid: 1x1",
        "    slots: 1",
        "    enabled: true",
        "  minis:",
        "    window: minis",
        "    grid: 1x1",
        "    max: 1",
        "    leads: [1]",
        "    enabled: true",
        "  logs:",
        "    window: logs",
        "    enabled: true",
        "seats:",
        "  root: seats",
        "  templates: [FOCUS, TASKS, REMINDER]",
        "state:",
        "  agentsJson: agents.json",
        "  meshAgentsJson: mesh-agents.json",
        "daemon:",
        "  port: 31999",
        "ports:",
        "  worker: '30{n}0/30{n}1'",
        "providers: [cursor-agent]",
        "roles:",
        "  dir: roles",
      ].join("\n"),
    );

    const result = writeProfileFormPatch(profilePath, {
      name: "demo2",
      session: { workerCount: 3 },
      daemon: { port: 32000, pollMs: 5000 },
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    const next = YAML.parse(fs.readFileSync(profilePath, "utf8")) as Record<string, unknown>;
    expect(next.name).toBe("demo2");
    expect((next.session as { workerCount: number }).workerCount).toBe(3);
    expect((next.daemon as { port: number }).port).toBe(32000);

    const form = profileToFormValues(next);
    expect(form.name).toBe("demo2");
    const doc = YAML.parseDocument(fs.readFileSync(profilePath, "utf8"));
    applyProfileFormPatch(doc, form);
    expect(doc.get("name")).toBe("demo2");
  });
});

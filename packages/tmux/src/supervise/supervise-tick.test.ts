import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { runSuperviseTick } from "./supervise-tick.js";

function tmpLoaded(): LoadedProfile {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-supervise-"));
  const profileDir = path.join(workspace, ".sm");
  fs.mkdirSync(profileDir, { recursive: true });
  return {
    workspace,
    profileDir,
    profilePath: path.join(profileDir, "mesh.config.yaml"),
    profile: {
      name: "test",
      workspace: ".",
      paths: { scope: "workspace" },
      session: { name: "mesh", workerCount: 2, miniMax: 2 },
      seats: {
        root: "tasks/agent-seats",
        templates: ["FOCUS", "TASKS", "REMINDER"],
        dirs: { manager: "manager", "manager-2": "manager-2", secretary: "secretary" },
      },
      layout: {
        base: {
          window: "base",
          columns: ["manager", "manager-2", "secretary"],
          kinds: { manager: "manager", "manager-2": "manager", secretary: "secretary" },
        },
      },
      state: { agentsJson: "a.json", meshAgentsJson: "m.json" },
      daemon: { port: 3100, managerPromptPrefix: "[mgr]" },
      providers: ["opencode"],
      roles: { dir: "roles" },
    },
  } as unknown as LoadedProfile;
}

function writeSeat(loaded: LoadedProfile, dir: string, mark: string, open: number): void {
  const seat = path.join(loaded.workspace, "tasks/agent-seats", dir);
  fs.mkdirSync(seat, { recursive: true });
  fs.writeFileSync(path.join(seat, "FOCUS.md"), `# ${dir} FOCUS\n\n**Mark:** ${mark}\n\n## NOW\n`);
  const taskLines = Array.from({ length: open }, (_, i) => `- [ ] task ${i + 1}`).join("\n");
  fs.writeFileSync(path.join(seat, "TASKS.md"), `## Open\n\n${taskLines}\n`);
}

const EMPTY_REGISTRY = {} as unknown as ProviderRegistry;

describe("runSuperviseTick dry-run", () => {
  it("computes status/diff and writes nothing", () => {
    const loaded = tmpLoaded();
    writeSeat(loaded, "manager", "BUSY", 3);
    writeSeat(loaded, "manager-2", "OPEN", 1);

    const r = runSuperviseTick(loaded, {
      session: "mesh",
      baseWindow: "base",
      registry: EMPTY_REGISTRY,
      dryRun: true,
    });

    expect(r.wroteLedger).toBe(false);
    expect(r.roomStatusPosted).toBe(false);
    expect(r.nudged).toEqual([]);
    expect(r.statusLine).toContain("manager");
    expect(r.statusLine).toContain("3 open");
    expect(r.materialChange).toBe(true);
    expect(r.priorText).toBe("");
    expect(r.leads).toHaveLength(2);
    expect(r.leads.map((l) => l.id)).toEqual(["manager", "manager-2"]);
    expect(r.leads[0]?.prior).toBeNull();
    expect(r.leads[0]?.now).toBe("BUSY:3");
    expect(r.tableLines.join("\n")).toContain("| manager | 3 | BUSY |");
    expect(fs.existsSync(r.lastPath)).toBe(false);
  });

  it("dry-run does not post room status even with material change", () => {
    const loaded = tmpLoaded();
    writeSeat(loaded, "manager", "BUSY", 2);
    writeSeat(loaded, "manager-2", "BUSY", 0);

    const r = runSuperviseTick(loaded, {
      session: "mesh",
      baseWindow: "base",
      registry: EMPTY_REGISTRY,
      dryRun: true,
      postStatus: true,
    });

    expect(r.materialChange).toBe(true);
    expect(r.roomStatusPosted).toBe(false);
    expect(r.wroteLedger).toBe(false);
  });

  it("matches prior tail when state unchanged after a real tick", () => {
    const loaded = tmpLoaded();
    writeSeat(loaded, "manager", "BUSY", 2);
    writeSeat(loaded, "manager-2", "OPEN", 1);

    const first = runSuperviseTick(loaded, {
      session: "mesh",
      baseWindow: "base",
      registry: EMPTY_REGISTRY,
    });
    expect(first.wroteLedger).toBe(true);
    expect(fs.existsSync(first.lastPath)).toBe(true);

    const second = runSuperviseTick(loaded, {
      session: "mesh",
      baseWindow: "base",
      registry: EMPTY_REGISTRY,
      dryRun: true,
    });
    expect(second.materialChange).toBe(false);
    expect(second.leads.every((l) => l.prior === l.now)).toBe(true);
    expect(second.wroteLedger).toBe(false);
  });

  it("parses hyphenated marks as prior (no false material change)", () => {
    const loaded = tmpLoaded();
    writeSeat(loaded, "manager", "FQ6-CLOSED", 1);
    writeSeat(loaded, "manager-2", "BUSY", 2);

    const first = runSuperviseTick(loaded, {
      session: "mesh",
      baseWindow: "base",
      registry: EMPTY_REGISTRY,
    });
    expect(first.wroteLedger).toBe(true);

    const second = runSuperviseTick(loaded, {
      session: "mesh",
      baseWindow: "base",
      registry: EMPTY_REGISTRY,
      dryRun: true,
    });
    expect(second.materialChange).toBe(false);
    expect(second.leads[0]?.prior).toBe("FQ6-CLOSED:1");
  });
});
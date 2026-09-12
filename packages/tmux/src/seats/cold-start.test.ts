import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";
import { buildColdStartBrief, buildFullColdStartBrief, openTaskLines } from "./cold-start.js";
import { runSeatInit } from "./seat-init.js";
import { gateQueuePath } from "./seat-paths.js";
import {
  clearColdStartStateForTests,
  invalidatePaneContext,
  isPaneContextReady,
  markColdStartDelivered,
  recordColdStartEnqueue,
  shouldSkipColdStartEnqueue,
} from "./cold-start-state.js";

function tmpLoaded(): LoadedProfile {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-cold-"));
  return {
    workspace,
    profileDir: workspace,
    profilePath: path.join(workspace, "mesh.config.yaml"),
    profile: {
      name: "test",
      workspace: ".",
      session: { name: "mesh", workerCount: 2, miniMax: 2 },
      seats: {
        root: "tasks/agent-seats",
        templates: ["FOCUS", "TASKS", "REMINDER"],
        dirs: { manager: "manager", worker: "slot-{n}", mini: "mini-{n}" },
      },
      state: { agentsJson: "a.json", meshAgentsJson: "m.json" },
      daemon: { port: 3100, managerPromptPrefix: "[mgr]" },
      providers: ["opencode"],
      roles: { dir: "roles" },
    },
  } as LoadedProfile;
}

describe("cold-start", () => {
  it("embeds gate queue and open tasks", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    const slotDir = path.join(loaded.workspace, "tasks/agent-seats/slot-1");
    fs.writeFileSync(
      path.join(slotDir, "TASKS.md"),
      "## Open\n\n- [ ] Fix overview-metrics\n\n## Done\n",
    );
    fs.writeFileSync(
      gateQueuePath(loaded),
      "| 6 | metrics | worker-6 | **OPEN** | fix |\n",
    );

    const brief = buildColdStartBrief(loaded, {
      inTmux: true,
      paneId: "%1",
      session: "mesh",
      window: "workers",
      role: "worker",
      slot: 1,
      slotLabel: "1",
      ports: "3010/3011",
      profile: "test",
      workspace: loaded.workspace,
    });

    expect(brief).toContain("GATE-QUEUE");
    expect(brief).toContain("Fix overview-metrics");
    expect(brief).toContain("worker-6");
    expect(brief).toContain("NO chat reply");
  });

  it("openTaskLines ignores done section", () => {
    const p = path.join(os.tmpdir(), `tasks-${Date.now()}.md`);
    fs.writeFileSync(
      p,
      "## Open\n\n- [ ] one\n\n## Done\n\n- [x] old\n",
    );
    expect(openTaskLines(p)).toEqual(["- [ ] one"]);
  });

  it("seat init is idempotent — second run creates nothing", () => {
    const loaded = tmpLoaded();
    const a = runSeatInit(loaded);
    expect(a.created.length).toBeGreaterThan(0);

    const focusPath = path.join(loaded.workspace, "tasks/agent-seats/slot-1/FOCUS.md");
    const before = fs.readFileSync(focusPath, "utf8");
    fs.writeFileSync(focusPath, before + "\n<!-- agent stamp -->\n");

    const b = runSeatInit(loaded);
    expect(b.created).toEqual([]);
    expect(fs.readFileSync(focusPath, "utf8")).toContain("agent stamp");
  });

  it("cold-start enqueue skips duplicate fingerprint", () => {
    const loaded = tmpLoaded();
    clearColdStartStateForTests(loaded);
    recordColdStartEnqueue(loaded, "%99", "slot-1", "fp-abc");
    expect(
      shouldSkipColdStartEnqueue(loaded, "%99", "slot-1", "fp-abc", {}),
    ).toBe(true);
    expect(
      shouldSkipColdStartEnqueue(loaded, "%99", "slot-1", "fp-new", {}),
    ).toBe(false);
    expect(
      shouldSkipColdStartEnqueue(loaded, "%99", "slot-1", "fp-abc", { force: true }),
    ).toBe(false);
  });

  it("context gate blocks until cold-start delivered", () => {
    const loaded = tmpLoaded();
    clearColdStartStateForTests(loaded);
    expect(isPaneContextReady(loaded, "%mb")).toBe(true);
    invalidatePaneContext(loaded, "%mb", "manager");
    expect(isPaneContextReady(loaded, "%mb")).toBe(false);
    markColdStartDelivered(loaded, "%mb");
    expect(isPaneContextReady(loaded, "%mb")).toBe(true);
  });
});

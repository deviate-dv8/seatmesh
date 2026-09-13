import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";
import { runSeatInit } from "./seat-init.js";
import {
  appendReminder,
  appendTask,
  checkTask,
  readSeatSnapshot,
  setFocusMark,
  setFocusNow,
} from "./seat-update.js";

function tmpLoaded(): LoadedProfile {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sm-seat-update-"));
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
  } as unknown as LoadedProfile;
}

describe("seat-update", () => {
  it("readSeatSnapshot returns null for an unresolvable target", () => {
    const loaded = tmpLoaded();
    expect(readSeatSnapshot(loaded, { role: "nobody" })).toBeNull();
  });

  it("readSeatSnapshot parses Mark/Updated and counts open/done", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    const dir = path.join(loaded.workspace, "tasks/agent-seats/slot-1");
    fs.writeFileSync(
      path.join(dir, "TASKS.md"),
      "## Open\n\n- [ ] a\n- [ ] b\n\n## Done (recent)\n\n- [x] c\n",
    );

    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap).not.toBeNull();
    expect(snap!.focus.mark).toBe("OPEN");
    expect(snap!.tasks.open).toBe(2);
    expect(snap!.tasks.done).toBe(1);
    expect(snap!.reminder.open).toBe(0);
  });

  it("setFocusNow writes NOW and marks BUSY", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    setFocusNow(loaded, { role: "worker", slot: "1" }, "5.6 workers layout");
    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap!.focus.mark).toBe("BUSY");
    expect(snap!.focus.text).toContain("## NOW");
    expect(snap!.focus.text).toContain("5.6 workers layout");
    expect(snap!.focus.text).not.toContain("cold-start block has GATE-QUEUE");
  });

  it("setFocusMark flips Mark and bumps Updated", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    setFocusMark(loaded, { role: "worker", slot: "1" }, "BUSY");

    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap!.focus.mark).toBe("BUSY");
    expect(snap!.focus.updatedStamp).toBe(new Date().toISOString().slice(0, 10));
  });

  it("setFocusMark throws when FOCUS.md is missing", () => {
    const loaded = tmpLoaded();
    expect(() => setFocusMark(loaded, { role: "worker", slot: "1" }, "OPEN")).toThrow();
  });

  it("appendTask adds a new open checkbox under ## Open", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    appendTask(loaded, { role: "worker", slot: "1" }, "new thing");

    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap!.tasks.text).toContain("- [ ] new thing");
    expect(snap!.tasks.open).toBe(1);
  });

  it("appendTask strips a lone (none) placeholder instead of leaving it behind", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    const p = path.join(loaded.workspace, "tasks/agent-seats/slot-1/TASKS.md");
    fs.writeFileSync(p, "## Open\n\n(none)\n\n## Done (recent)\n\n");

    appendTask(loaded, { role: "worker", slot: "1" }, "real task");

    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap!.tasks.text).not.toContain("(none)");
    expect(snap!.tasks.text).toContain("- [ ] real task");
    expect(snap!.tasks.open).toBe(1);
  });

  it("checkTask moves a matching open line to Done (recent) and returns true", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    appendTask(loaded, { role: "worker", slot: "1" }, "ship the thing");

    const ok = checkTask(loaded, { role: "worker", slot: "1" }, "ship the thing");
    expect(ok).toBe(true);

    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap!.tasks.open).toBe(0);
    expect(snap!.tasks.done).toBe(1);
    expect(snap!.tasks.text).toMatch(/- \[x\] \d{4}-\d{2}-\d{2} ship the thing/);
  });

  it("checkTask returns false when no line matches", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    expect(checkTask(loaded, { role: "worker", slot: "1" }, "nonexistent")).toBe(false);
  });

  it("appendReminder appends a timestamped bullet", () => {
    const loaded = tmpLoaded();
    runSeatInit(loaded);
    appendReminder(loaded, { role: "worker", slot: "1" }, "check the gate queue");

    const snap = readSeatSnapshot(loaded, { role: "worker", slot: "1" });
    expect(snap!.reminder.text).toContain("check the gate queue");
  });
});

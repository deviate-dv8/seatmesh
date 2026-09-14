import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cancelActiveTargetsWithGoal,
  findTarget,
  markTargetStatus,
  readTargets,
  upsertTarget,
  type TargetRow,
} from "./target-jsonl.js";

describe("target-jsonl", () => {
  let tmp = "";
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("upserts, finds by prefix, done/cancel, dedupes goal", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-tgt-"));
    const file = path.join(tmp, "TARGET.jsonl");
    const now = new Date().toISOString();
    const row: TargetRow = {
      id: "tgt-abc12345",
      status: "active",
      goal: "finish s13 tickets",
      deadlineAt: now,
      createdAt: now,
      updatedAt: now,
      triageTo: ["manager", "secretary"],
      source: "operator",
    };
    upsertTarget(file, row);
    expect(readTargets(file)).toHaveLength(1);
    expect(findTarget(file, "tgt-abc")?.goal).toBe("finish s13 tickets");

    cancelActiveTargetsWithGoal(file, "finish s13 tickets");
    expect(readTargets(file)[0]?.status).toBe("cancelled");

    const row2 = { ...row, id: "tgt-xyz99999", status: "active" as const };
    upsertTarget(file, row2);
    markTargetStatus(file, "tgt-xyz", "done");
    expect(findTarget(file, "tgt-xyz")?.status).toBe("done");
  });
});

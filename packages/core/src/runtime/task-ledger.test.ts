import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listTasks,
  markTaskDoneByMatch,
  readTasks,
  recordTaskOpen,
  summarizeTasks,
} from "./task-ledger.js";

const tmpFiles: string[] = [];

function tmpLedger(): string {
  const f = path.join(os.tmpdir(), `sm-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  tmpFiles.push(f);
  return f;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ok */
    }
  }
});

describe("task-ledger", () => {
  it("records open task with timestamps", () => {
    const file = tmpLedger();
    const row = recordTaskOpen(file, {
      sessionId: "abc123",
      sessionName: "mesh-abc123",
      seat: "slot-1",
      text: "fix login",
      source: "give",
      assignedBy: "manager",
    });
    expect(row.status).toBe("open");
    expect(row.createdAt).toMatch(/^\d{4}-/);
    expect(readTasks(file)).toHaveLength(1);
  });

  it("dedupes open task with same seat+text", () => {
    const file = tmpLedger();
    const a = recordTaskOpen(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      seat: "slot-2",
      text: "same task",
      source: "add",
    });
    const b = recordTaskOpen(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      seat: "slot-2",
      text: "same task",
      source: "add",
    });
    expect(a.id).toBe(b.id);
    expect(readTasks(file)).toHaveLength(1);
  });

  it("marks done with completedAt", () => {
    const file = tmpLedger();
    recordTaskOpen(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      seat: "manager",
      text: "ship feature X",
      source: "assign",
    });
    const done = markTaskDoneByMatch(file, "manager", "feature X");
    expect(done?.status).toBe("done");
    expect(done?.completedAt).toMatch(/^\d{4}-/);
    expect(listTasks(file, { all: true, status: "done" })).toHaveLength(1);
    expect(listTasks(file)).toHaveLength(0);
  });

  it("summarizes counts", () => {
    const file = tmpLedger();
    recordTaskOpen(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      seat: "slot-1",
      text: "a",
      source: "add",
    });
    recordTaskOpen(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      seat: "slot-2",
      text: "b",
      source: "add",
    });
    markTaskDoneByMatch(file, "slot-1", "a");
    const s = summarizeTasks(readTasks(file));
    expect(s.open).toBe(1);
    expect(s.done).toBe(1);
    expect(s.updatedAt).toMatch(/^\d{4}-/);
  });
});

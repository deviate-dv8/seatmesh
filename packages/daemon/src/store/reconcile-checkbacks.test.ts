import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckbackRow } from "./jsonl-store.js";
import { reconcileCheckbacksFromJsonl } from "./reconcile-checkbacks.js";
import type { QueueStore } from "./create-queue-store.js";

function memStore(seed: CheckbackRow[] = []): QueueStore {
  let rows = [...seed];
  return {
    readCheckbacks: () => [...rows],
    upsertCheckback: (row: CheckbackRow) => {
      rows = rows.filter((r) => r.id !== row.id);
      rows.push(row);
      return row;
    },
  } as unknown as QueueStore;
}

describe("reconcileCheckbacksFromJsonl", () => {
  it("imports active jsonl rows missing from store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-cb-"));
    const store = memStore();
    fs.writeFileSync(
      path.join(dir, "CHECKBACK.jsonl"),
      JSON.stringify({
        id: "mesh-secretary-supervise",
        kind: "secretary-supervise",
        status: "active",
        renewSec: 600,
        expect: "supervise tick",
        ownerPane: "%1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) + "\n",
    );
    const n = reconcileCheckbacksFromJsonl(store, dir);
    expect(n).toBe(1);
    expect(store.readCheckbacks().map((r) => r.id)).toContain("mesh-secretary-supervise");
  });

  it("skips ids already active in store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-cb2-"));
    const store = memStore([
      {
        id: "mesh-secretary-supervise",
        kind: "secretary-supervise",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    fs.writeFileSync(
      path.join(dir, "CHECKBACK.jsonl"),
      JSON.stringify({
        id: "mesh-secretary-supervise",
        kind: "secretary-supervise",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) + "\n",
    );
    expect(reconcileCheckbacksFromJsonl(store, dir)).toBe(0);
  });
});

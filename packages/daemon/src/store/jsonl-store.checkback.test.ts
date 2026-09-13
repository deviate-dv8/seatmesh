import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { JsonlStore } from "./jsonl-store.js";

describe("JsonlStore checkback reset/ack", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reset pushes expiry and ack yes cancels", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-cb-"));
    const store = new JsonlStore(tmp);
    const row = store.upsertCheckback({
      id: "cb-test-001",
      kind: "checkback",
      status: "active",
      expect: "proxy ipify",
      ownerPane: "%1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const next = new Date(Date.now() + 300_000).toISOString();
    const reset = store.resetCheckback("cb-test", next);
    expect(reset?.id).toBe(row.id);
    expect(reset?.expiresAt).toBe(next);
    expect(reset?.status).toBe("active");

    const ack = store.ackCheckback("cb-test", true);
    expect(ack.ok).toBe(true);
    expect(ack.action).toBe("matched");

    const found = store.findCheckback(row.id);
    expect(found?.status).toBe("cancelled");
  });

  it("ack no leaves checkback active", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sm-cb-"));
    const store = new JsonlStore(tmp);
    store.upsertCheckback({
      id: "cb-ignore-1",
      kind: "checkback",
      status: "active",
      expect: "topic",
      ownerPane: "%2",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const ack = store.ackCheckback("cb-ignore", false);
    expect(ack.ok).toBe(true);
    expect(ack.action).toBe("ignored");
    expect(store.findCheckback("cb-ignore")?.status).toBe("active");
  });
});

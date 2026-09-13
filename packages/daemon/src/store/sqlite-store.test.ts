import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { JsonlStore } from "./jsonl-store.js";
import { migrateJsonlDirToSqlite, SqliteStore } from "./sqlite-store.js";

const require = createRequire(import.meta.url);

function sqliteNativeAvailable(): boolean {
  try {
    const Ctor = require("better-sqlite3") as new (filename: string) => { close(): void };
    const db = new Ctor(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!sqliteNativeAvailable())("SqliteStore", () => {
  it("roundtrips inbox and peer rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-sqlite-"));
    const db = path.join(dir, "mesh.sqlite");
    const store = new SqliteStore(db, path.join(dir, "daemon"));
    store.appendInbox({
      id: "in-1",
      at: new Date().toISOString(),
      from: "worker",
      slot: "3",
      ports: "3030/3031",
      msg: "DONE: test",
      sent: false,
      resolved: false,
      read: false,
    });
    store.appendPeer({
      id: "pe-1",
      at: new Date().toISOString(),
      kind: "room",
      fromSlot: "3",
      fromPorts: null,
      targetPane: "%0",
      targetLabel: "slot-3",
      msg: "FYI",
      sent: false,
    });
    expect(store.readInbox()).toHaveLength(1);
    expect(store.readPeer()).toHaveLength(1);
    store.close();
  });

  it("migrates jsonl dir once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-migrate-"));
    const jsonlDir = path.join(dir, "daemon");
    fs.mkdirSync(jsonlDir, { recursive: true });
    const jl = new JsonlStore(jsonlDir);
    jl.appendInbox({
      id: "m1",
      at: new Date().toISOString(),
      from: "worker",
      slot: "1",
      ports: null,
      msg: "migrate me",
      sent: false,
      resolved: false,
      read: false,
    });
    const db = path.join(dir, "mesh.sqlite");
    const log: string[] = [];
    expect(migrateJsonlDirToSqlite(db, jsonlDir, (l) => log.push(l))).toBe(true);
    const store = new SqliteStore(db, jsonlDir);
    expect(store.readInbox()).toHaveLength(1);
    expect(migrateJsonlDirToSqlite(db, jsonlDir, () => {})).toBe(false);
    store.close();
  });
});

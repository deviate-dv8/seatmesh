import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { formatMeshSteeringInject, type PaneOpRow } from "@seat-mesh/core";
import {
  dedupeJsonlRowsById,
  type CheckbackRow,
  type PeerRow,
  type ToMasterRow,
} from "./jsonl-store.js";

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F;
  close(): void;
}

const require = createRequire(import.meta.url);

function openSqliteDb(dbPath: string): SqliteDb {
  const Ctor = require("better-sqlite3") as new (filename: string) => SqliteDb;
  return new Ctor(dbPath);
}

function sqlRows<T>(rows: unknown[], map: (row: Record<string, unknown>) => T): T[] {
  return rows.map((row) => map(row as Record<string, unknown>));
}

function sqlChanges(result: unknown): number {
  return Number((result as { changes?: number }).changes ?? 0);
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  slot TEXT,
  ports TEXT,
  msg TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  delivered_to TEXT,
  deliver_pane TEXT,
  deliver_mode TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  read_flag INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS peer (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_slot TEXT NOT NULL,
  from_ports TEXT,
  room_slug TEXT,
  from_agent TEXT,
  target_pane TEXT NOT NULL,
  target_label TEXT NOT NULL,
  msg TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  deliver_pane TEXT,
  deliver_mode TEXT
);

CREATE TABLE IF NOT EXISTS checkback (
  id TEXT PRIMARY KEY,
  kind TEXT,
  status TEXT NOT NULL,
  renew_sec INTEGER,
  expect TEXT,
  owner_pane TEXT,
  expires_at TEXT,
  sender_label TEXT,
  recipient_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pane_ops (
  id TEXT PRIMARY KEY,
  row_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_pending ON inbox(sent, resolved);
CREATE INDEX IF NOT EXISTS idx_peer_pending ON peer(sent);
CREATE INDEX IF NOT EXISTS idx_checkback_active ON checkback(status, expires_at);
`;

function bool(v: boolean): number {
  return v ? 1 : 0;
}

function readJsonlFile<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter((r): r is T => r !== null);
}

export function migrateJsonlDirToSqlite(
  dbPath: string,
  jsonlDir: string,
  log: (line: string) => void,
): boolean {
  if (fs.existsSync(dbPath)) {
    const db = openSqliteDb(dbPath);
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("migrated_from_jsonl");
    db.close();
    if (row) return false;
  }

  const inboxPath = path.join(jsonlDir, "INBOX.jsonl");
  const peerPath = path.join(jsonlDir, "PEER.jsonl");
  const checkPath = path.join(jsonlDir, "CHECKBACK.jsonl");
  const panePath = path.join(jsonlDir, "PANE_OPS.jsonl");
  const hasAny =
    fs.existsSync(inboxPath) ||
    fs.existsSync(peerPath) ||
    fs.existsSync(checkPath) ||
    fs.existsSync(panePath);
  if (!hasAny) return false;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = new SqliteStore(dbPath, jsonlDir, log);
  const inbox = readJsonlFile<ToMasterRow>(inboxPath);
  const peer = dedupeJsonlRowsById(readJsonlFile<PeerRow>(peerPath));
  const checkbacks = readJsonlFile<CheckbackRow>(checkPath);
  const paneOps = readJsonlFile<PaneOpRow>(panePath);

  if (inbox.length) store.writeInbox(inbox);
  if (peer.length) store.writePeer(peer);
  if (checkbacks.length) store.writeCheckbacks(checkbacks);
  if (paneOps.length) store.writePaneOps(paneOps);

  store.setMeta("migrated_from_jsonl", new Date().toISOString());
  log(
    `SQLITE migrate jsonl -> ${dbPath} inbox=${inbox.length} peer=${peer.length} checkback=${checkbacks.length} pane_ops=${paneOps.length}`,
  );
  return true;
}

export class SqliteStore {
  private readonly db: SqliteDb;

  constructor(
    dbPath: string,
    readonly stateDir: string,
    readonly log: (line: string) => void = () => {},
  ) {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = openSqliteDb(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  get checkbackPath(): string {
    return path.join(this.stateDir, "CHECKBACK.jsonl");
  }
  get inboxPath(): string {
    return path.join(this.stateDir, "INBOX.jsonl");
  }
  get peerPath(): string {
    return path.join(this.stateDir, "PEER.jsonl");
  }
  get paneOpsPath(): string {
    return path.join(this.stateDir, "PANE_OPS.jsonl");
  }

  readCheckbacks(): CheckbackRow[] {
    return sqlRows(
      this.db.prepare("SELECT * FROM checkback ORDER BY created_at").all(),
      rowToCheckback,
    );
  }

  writeCheckbacks(rows: CheckbackRow[]): void {
    const del = this.db.prepare("DELETE FROM checkback");
    const ins = this.db.prepare(`
      INSERT INTO checkback(id, kind, status, renew_sec, expect, owner_pane, expires_at, sender_label, recipient_label, created_at, updated_at)
      VALUES (@id, @kind, @status, @renewSec, @expect, @ownerPane, @expiresAt, @senderLabel, @recipientLabel, @createdAt, @updatedAt)
    `);
    this.db.transaction(() => {
      del.run();
      for (const r of rows) ins.run(r);
    })();
  }

  upsertCheckback(row: CheckbackRow): CheckbackRow {
    this.db
      .prepare(`
      INSERT INTO checkback(id, kind, status, renew_sec, expect, owner_pane, expires_at, sender_label, recipient_label, created_at, updated_at)
      VALUES (@id, @kind, @status, @renewSec, @expect, @ownerPane, @expiresAt, @senderLabel, @recipientLabel, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        kind=excluded.kind, status=excluded.status, renew_sec=excluded.renew_sec, expect=excluded.expect,
        owner_pane=excluded.owner_pane, expires_at=excluded.expires_at, sender_label=excluded.sender_label,
        recipient_label=excluded.recipient_label, updated_at=excluded.updated_at
    `)
      .run(row);
    return row;
  }

  cancelCheckback(id: string): boolean {
    const r = this.db
      .prepare(
        "UPDATE checkback SET status = 'cancelled', updated_at = ? WHERE status = 'active' AND (id = ? OR id LIKE ?)",
      )
      .run(new Date().toISOString(), id, `${id}%`);
    return sqlChanges(r) > 0;
  }

  cancelAllCheckbacks(): number {
    const r = this.db
      .prepare(
        "UPDATE checkback SET status = 'cancelled', updated_at = ? WHERE status = 'active'",
      )
      .run(new Date().toISOString());
    return sqlChanges(r);
  }

  cancelCheckbacksForPaneExpect(ownerPane: string, expect: string): number {
    const r = this.db
      .prepare(
        "UPDATE checkback SET status = 'cancelled', updated_at = ? WHERE status = 'active' AND owner_pane = ? AND expect = ?",
      )
      .run(new Date().toISOString(), ownerPane, expect);
    return sqlChanges(r);
  }

  clearPaneOps(): number {
    const rows = this.readPaneOps();
    const open = rows.filter((r) => r.status === "pending" || r.status === "running");
    const kept = rows.filter((r) => r.status !== "pending" && r.status !== "running");
    if (open.length) this.writePaneOps(kept);
    return open.length;
  }

  readInbox(): ToMasterRow[] {
    return sqlRows(this.db.prepare("SELECT * FROM inbox ORDER BY at").all(), rowToInbox);
  }

  writeInbox(rows: ToMasterRow[]): void {
    const del = this.db.prepare("DELETE FROM inbox");
    const ins = this.db.prepare(`
      INSERT INTO inbox(id, at, from_agent, slot, ports, msg, sent, sent_at, delivered_to, deliver_pane, deliver_mode, resolved, read_flag)
      VALUES (@id, @at, @from, @slot, @ports, @msg, @sent, @sentAt, @deliveredTo, @deliverPane, @deliverMode, @resolved, @read)
    `);
    this.db.transaction(() => {
      del.run();
      for (const r of rows) {
        ins.run({
          ...r,
          sent: bool(r.sent),
          resolved: bool(r.resolved),
          read: bool(r.read),
        });
      }
    })();
  }

  appendInbox(row: ToMasterRow): void {
    this.db
      .prepare(`
      INSERT OR REPLACE INTO inbox(id, at, from_agent, slot, ports, msg, sent, sent_at, delivered_to, deliver_pane, deliver_mode, resolved, read_flag)
      VALUES (@id, @at, @from, @slot, @ports, @msg, @sent, @sentAt, @deliveredTo, @deliverPane, @deliverMode, @resolved, @read)
    `)
      .run({
        ...row,
        sent: bool(row.sent),
        resolved: bool(row.resolved),
        read: bool(row.read),
      });
  }

  resolveInbox(opts: { id?: string; all?: boolean }): { resolved: number; ids: string[] } {
    const rows = this.readInbox();
    const ids: string[] = [];
    let resolved = 0;
    for (const r of rows) {
      if (r.resolved) continue;
      const hit =
        opts.all === true ||
        (opts.id != null && (r.id === opts.id || r.id.startsWith(opts.id)));
      if (!hit) continue;
      r.resolved = true;
      r.read = true;
      ids.push(r.id);
      resolved++;
    }
    if (resolved > 0) {
      const stmt = this.db.prepare(
        "UPDATE inbox SET resolved = 1, read_flag = 1 WHERE id = ?",
      );
      for (const id of ids) stmt.run(id);
    }
    return { resolved, ids };
  }

  readPeer(): PeerRow[] {
    return dedupeJsonlRowsById(
      this.db
        .prepare("SELECT * FROM peer ORDER BY at")
        .all()
        .map((row: unknown) => rowToPeer(row as Record<string, unknown>)),
    ) as PeerRow[];
  }

  writePeer(rows: PeerRow[]): void {
    const del = this.db.prepare("DELETE FROM peer");
    const ins = this.db.prepare(`
      INSERT INTO peer(id, at, kind, from_slot, from_ports, room_slug, from_agent, target_pane, target_label, msg, sent, sent_at, deliver_pane, deliver_mode)
      VALUES (@id, @at, @kind, @fromSlot, @fromPorts, @roomSlug, @fromAgent, @targetPane, @targetLabel, @msg, @sent, @sentAt, @deliverPane, @deliverMode)
    `);
    this.db.transaction(() => {
      del.run();
      for (const r of rows) {
        ins.run({ ...r, sent: bool(r.sent) });
      }
    })();
  }

  appendPeer(row: PeerRow): void {
    this.db
      .prepare(`
      INSERT OR REPLACE INTO peer(id, at, kind, from_slot, from_ports, room_slug, from_agent, target_pane, target_label, msg, sent, sent_at, deliver_pane, deliver_mode)
      VALUES (@id, @at, @kind, @fromSlot, @fromPorts, @roomSlug, @fromAgent, @targetPane, @targetLabel, @msg, @sent, @sentAt, @deliverPane, @deliverMode)
    `)
      .run({ ...row, sent: bool(row.sent) });
  }

  appendPeers(rows: PeerRow[]): void {
    for (const row of rows) this.appendPeer(row);
  }

  readPaneOps(): PaneOpRow[] {
    return this.db
      .prepare("SELECT row_json FROM pane_ops")
      .all()
      .map((row: unknown) =>
        JSON.parse(String((row as { row_json: string }).row_json)) as PaneOpRow,
      );
  }

  writePaneOps(rows: PaneOpRow[]): void {
    const del = this.db.prepare("DELETE FROM pane_ops");
    const ins = this.db.prepare("INSERT INTO pane_ops(id, row_json) VALUES (?, ?)");
    this.db.transaction(() => {
      del.run();
      for (const r of rows) ins.run(r.id, JSON.stringify(r));
    })();
  }

  appendPaneOp(row: PaneOpRow): void {
    this.db
      .prepare("INSERT OR REPLACE INTO pane_ops(id, row_json) VALUES (?, ?)")
      .run(row.id, JSON.stringify(row));
  }

  updatePaneOp(row: PaneOpRow): void {
    this.appendPaneOp(row);
  }

  countPaneOpsPending(): number {
    return this.readPaneOps().filter((r) => r.status === "pending" || r.status === "running").length;
  }

  formatInboxInject(row: ToMasterRow, targetRole: "manager" | "secretary" = "manager"): string {
    const from = String(row.from ?? "").trim();
    const slot = row.slot != null ? String(row.slot) : "";
    let who: string;
    if (from === "secretary" || from === "manager" || slot === "secretary" || slot === "manager") {
      who = from || slot;
    } else if (/^\d+$/.test(slot)) {
      who = `slot-${slot}${row.ports ? ` (${row.ports})` : ""}`;
    } else {
      who = from || slot || "unknown";
    }
    const body = String(row.msg || "").trim().slice(0, 400);
    const label =
      targetRole === "secretary" ? `TO-SECRETARY from ${who}` : `TO-MASTER from ${who}`;
    return formatMeshSteeringInject({ role: targetRole }, label, body);
  }

  compactPeer(): number {
    const raw = this.db
      .prepare("SELECT * FROM peer ORDER BY at")
      .all()
      .map((row: unknown) => rowToPeer(row as Record<string, unknown>));
    const deduped = dedupeJsonlRowsById(raw) as PeerRow[];
    if (deduped.length === raw.length) return 0;
    this.writePeer(deduped);
    return raw.length - deduped.length;
  }
}

function rowToInbox(row: Record<string, unknown>): ToMasterRow {
  return {
    id: String(row.id),
    at: String(row.at),
    from: String(row.from_agent),
    slot: row.slot != null ? String(row.slot) : null,
    ports: row.ports != null ? String(row.ports) : null,
    msg: String(row.msg),
    sent: Number(row.sent) === 1,
    sentAt: row.sent_at != null ? String(row.sent_at) : undefined,
    deliveredTo: row.delivered_to != null ? String(row.delivered_to) : undefined,
    deliverPane: row.deliver_pane != null ? String(row.deliver_pane) : undefined,
    deliverMode:
      row.deliver_mode === "idle" || row.deliver_mode === "steer"
        ? row.deliver_mode
        : undefined,
    resolved: Number(row.resolved) === 1,
    read: Number(row.read_flag) === 1,
  };
}

function rowToPeer(row: Record<string, unknown>): PeerRow {
  return {
    id: String(row.id),
    at: String(row.at),
    kind: row.kind as PeerRow["kind"],
    fromSlot: String(row.from_slot),
    fromPorts: row.from_ports != null ? String(row.from_ports) : null,
    roomSlug: row.room_slug != null ? String(row.room_slug) : null,
    fromAgent: row.from_agent != null ? String(row.from_agent) : null,
    targetPane: String(row.target_pane),
    targetLabel: String(row.target_label),
    msg: String(row.msg),
    sent: Number(row.sent) === 1,
    sentAt: row.sent_at != null ? String(row.sent_at) : undefined,
    deliverPane: row.deliver_pane != null ? String(row.deliver_pane) : undefined,
    deliverMode:
      row.deliver_mode === "idle" || row.deliver_mode === "steer"
        ? row.deliver_mode
        : undefined,
  };
}

function rowToCheckback(row: Record<string, unknown>): CheckbackRow {
  return {
    id: String(row.id),
    kind: String(row.kind ?? ""),
    status: row.status === "cancelled" ? "cancelled" : "active",
    renewSec: row.renew_sec != null ? Number(row.renew_sec) : undefined,
    expect: row.expect != null ? String(row.expect) : undefined,
    ownerPane: row.owner_pane != null ? String(row.owner_pane) : undefined,
    expiresAt: row.expires_at != null ? String(row.expires_at) : undefined,
    senderLabel: row.sender_label != null ? String(row.sender_label) : undefined,
    recipientLabel: row.recipient_label != null ? String(row.recipient_label) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

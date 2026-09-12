import fs from "node:fs";
import path from "node:path";
import { formatMeshSteeringInject, type PaneOpRow } from "@seat-mesh/core";

export interface CheckbackRow {
  id: string;
  kind: string;
  status: "active" | "cancelled";
  renewSec?: number;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
  senderLabel?: string;
  recipientLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToMasterRow {
  id: string;
  at: string;
  from: string;
  slot: string | null;
  ports: string | null;
  msg: string;
  sent: boolean;
  /** Set only after deliverToPane + post-verify. sent:true without sentAt is ignored (hand-forged). */
  sentAt?: string;
  deliveredTo?: string;
  deliverPane?: string;
  deliverMode?: "idle" | "steer";
  resolved: boolean;
  read: boolean;
}

export type PeerKind = "to-slot" | "to-mini" | "prompt" | "remind" | "room";

export interface PeerRow {
  id: string;
  at: string;
  kind: PeerKind;
  fromSlot: string;
  fromPorts: string | null;
  /** Room slug when kind=room (fan-out / room PM). */
  roomSlug?: string | null;
  /** Sender agent id (worker-N) for room-comms expect lines. */
  fromAgent?: string | null;
  targetPane: string;
  targetLabel: string;
  msg: string;
  sent: boolean;
  sentAt?: string;
  deliverPane?: string;
  deliverMode?: "idle" | "steer";
}

/** Delivered = inject succeeded AND proof fields stamped (not hand-set sent:true). */
export function isInboxDelivered(row: ToMasterRow): boolean {
  return row.sent === true && Boolean(row.sentAt) && Boolean(row.deliverPane);
}

export function isPeerDelivered(row: PeerRow): boolean {
  return row.sent === true && Boolean(row.sentAt) && Boolean(row.deliverPane);
}

export type QueueStore = JsonlStore;

export class JsonlStore {
  constructor(
    readonly stateDir: string,
    readonly log: (line: string) => void = () => {},
  ) {
    fs.mkdirSync(stateDir, { recursive: true });
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
    return this.readJsonl<CheckbackRow>(this.checkbackPath);
  }

  writeCheckbacks(rows: CheckbackRow[]): void {
    this.writeJsonl(this.checkbackPath, rows);
  }

  upsertCheckback(row: CheckbackRow): CheckbackRow {
    const rows = this.readCheckbacks().filter((r) => r.id !== row.id);
    rows.push(row);
    this.writeCheckbacks(rows);
    return row;
  }

  cancelCheckback(id: string): boolean {
    const rows = this.readCheckbacks();
    let hit = false;
    for (const r of rows) {
      if (r.id === id || r.id.startsWith(id)) {
        r.status = "cancelled";
        r.updatedAt = new Date().toISOString();
        hit = true;
      }
    }
    if (hit) this.writeCheckbacks(rows);
    return hit;
  }

  /** Cancel every active checkback (burst renew / comms spam relief). */
  cancelAllCheckbacks(): number {
    const rows = this.readCheckbacks();
    const now = new Date().toISOString();
    let n = 0;
    for (const r of rows) {
      if (r.status !== "active") continue;
      r.status = "cancelled";
      r.updatedAt = now;
      n++;
    }
    if (n) this.writeCheckbacks(rows);
    return n;
  }

  /** Cancel active checkbacks for the same pane + expect (dedupe before arm). */
  cancelCheckbacksForPaneExpect(ownerPane: string, expect: string): number {
    const rows = this.readCheckbacks();
    const now = new Date().toISOString();
    let n = 0;
    for (const r of rows) {
      if (r.status !== "active") continue;
      if (r.ownerPane !== ownerPane || r.expect !== expect) continue;
      r.status = "cancelled";
      r.updatedAt = now;
      n++;
    }
    if (n) this.writeCheckbacks(rows);
    return n;
  }

  clearPaneOps(): number {
    const rows = this.readPaneOps();
    const open = rows.filter((r) => r.status === "pending" || r.status === "running");
    const kept = rows.filter((r) => r.status !== "pending" && r.status !== "running");
    if (open.length) this.writePaneOps(kept);
    return open.length;
  }

  readInbox(): ToMasterRow[] {
    return this.readJsonl<ToMasterRow>(this.inboxPath);
  }

  writeInbox(rows: ToMasterRow[]): void {
    this.writeJsonl(this.inboxPath, rows);
  }

  appendInbox(row: ToMasterRow): void {
    fs.appendFileSync(this.inboxPath, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  }

  /** Mark inbox rows resolved (id prefix match or all unresolved). */
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
    if (resolved > 0) this.writeInbox(rows);
    return { resolved, ids };
  }

  readPeer(): PeerRow[] {
    return dedupeJsonlRowsById(this.readJsonl<PeerRow>(this.peerPath));
  }

  writePeer(rows: PeerRow[]): void {
    this.writeJsonl(this.peerPath, rows);
  }

  appendPeer(row: PeerRow): void {
    fs.appendFileSync(this.peerPath, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  }

  appendPeers(rows: PeerRow[]): void {
    if (!rows.length) return;
    const chunk = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.appendFileSync(this.peerPath, chunk, { encoding: "utf8", flag: "a" });
  }

  readPaneOps(): PaneOpRow[] {
    return this.readJsonl<PaneOpRow>(this.paneOpsPath);
  }

  writePaneOps(rows: PaneOpRow[]): void {
    this.writeJsonl(this.paneOpsPath, rows);
  }

  appendPaneOp(row: PaneOpRow): void {
    fs.appendFileSync(this.paneOpsPath, JSON.stringify(row) + "\n", {
      encoding: "utf8",
      flag: "a",
    });
  }

  updatePaneOp(row: PaneOpRow): void {
    const rows = this.readPaneOps();
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) {
      rows[i] = row;
      this.writePaneOps(rows);
    }
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

  /** Compact PEER.jsonl when append+update left duplicate ids (last row wins). */
  compactPeer(): number {
    const raw = this.readJsonl<PeerRow>(this.peerPath);
    const deduped = dedupeJsonlRowsById(raw);
    if (deduped.length === raw.length) return 0;
    this.writePeer(deduped);
    return raw.length - deduped.length;
  }

  private readJsonl<T>(file: string): T[] {
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

  private writeJsonl(file: string, rows: unknown[]): void {
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  }
}

/** Dedupe peer rows by id — prefer delivered proof over stale pending duplicates. */
export function dedupeJsonlRowsById<T extends { id: string; sent?: boolean; sentAt?: string }>(
  rows: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    const prevOk = prev.sent === true && Boolean(prev.sentAt);
    const rowOk = row.sent === true && Boolean(row.sentAt);
    if (rowOk && !prevOk) byId.set(row.id, row);
    else if (!rowOk && prevOk) continue;
    else byId.set(row.id, row);
  }
  return [...byId.values()];
}

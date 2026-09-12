import fs from "node:fs";
import type { ProviderRegistry } from "@seat-mesh/core";
import { capturePaneSnapshot, tmux } from "@seat-mesh/tmux";
import type { QueueStore, PeerRow } from "./create-queue-store.js";
import { isPeerDelivered } from "./create-queue-store.js";

export interface PeerBacklogRow extends PeerRow {
  status: "backlog";
  backlogAt: string;
  holdReason: string;
}

const BUSY_HOLD = /^held:(busy|typing)/;

/** Lightweight mail — deliver even when busy; agent ACKs in shell, hub stays rank-1. */
export function isAckClassPeer(msg: string): boolean {
  const body = msg.replace(/^\[[^\]]+\]\s*/, "").trim();
  return /^(ACK|FYI|STAND-?BY|MCP-?SYNCED|CHECKBACK\?)\b/i.test(body);
}

/** Active HUB beats coordination mail — park unless ACK-class or explicit override. */
export function shouldBacklogPeerHold(reason: string, msg: string): boolean {
  if (isAckClassPeer(msg)) return false;
  if (/\bPRIORITY\b|\bSTOP other work\b/i.test(msg)) return false;
  if (BUSY_HOLD.test(reason)) return true;
  if (/^held:coord:/.test(reason)) return false;
  return false;
}

export function peerBacklogPath(store: QueueStore): string {
  return `${store.stateDir}/PEER-BACKLOG.jsonl`;
}

function readBacklog(store: QueueStore): PeerBacklogRow[] {
  const p = peerBacklogPath(store);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as PeerBacklogRow;
      } catch {
        return null;
      }
    })
    .filter((r): r is PeerBacklogRow => r !== null && r.status === "backlog");
}

function writeBacklog(store: QueueStore, rows: PeerBacklogRow[]): void {
  const p = peerBacklogPath(store);
  fs.writeFileSync(
    p,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
  );
}

function paneStatusMark(paneId: string): string {
  return (
    tmux(["display-message", "-t", paneId, "-p", "#{@mesh_status}"]).out?.trim() ?? ""
  );
}

function paneIdleForPromote(paneId: string, registry: ProviderRegistry): boolean {
  const mark = paneStatusMark(paneId);
  if (/\bBUSY\b/i.test(mark)) return false;
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov) return false;
  const st = prov.composerState(snap);
  return st.phase === "empty" || st.phase === "afk";
}

/** Re-queue oldest backlog row per idle pane (one promote per pane per tick). */
export function promotePeerBacklog(
  store: QueueStore,
  registry: ProviderRegistry,
  log: (line: string) => void,
): number {
  const backlog = readBacklog(store);
  if (!backlog.length) return 0;

  const peer = store.readPeer();
  const byPane = new Map<string, PeerBacklogRow[]>();
  for (const row of backlog) {
    const list = byPane.get(row.targetPane) ?? [];
    list.push(row);
    byPane.set(row.targetPane, list);
  }

  let promoted = 0;
  const kept: PeerBacklogRow[] = [];

  for (const [, rows] of byPane) {
    rows.sort((a, b) => a.backlogAt.localeCompare(b.backlogAt));
    const paneId = rows[0]!.targetPane;
    if (!paneIdleForPromote(paneId, registry)) {
      kept.push(...rows);
      continue;
    }
    const [first, ...rest] = rows;
    const revived: PeerRow = {
      id: first.id,
      at: first.at,
      kind: first.kind,
      fromSlot: first.fromSlot,
      fromPorts: first.fromPorts,
      roomSlug: first.roomSlug,
      fromAgent: first.fromAgent,
      targetPane: first.targetPane,
      targetLabel: first.targetLabel,
      msg: first.msg,
      sent: false,
    };
    peer.push(revived);
    promoted++;
    log(`PEER backlog promote id=${first.id} -> ${first.targetLabel}`);
    kept.push(...rest);
  }

  if (promoted) store.writePeer(peer);
  writeBacklog(store, kept);
  return promoted;
}

export function parkPeerToBacklog(
  store: QueueStore,
  row: PeerRow,
  holdReason: string,
  log: (line: string) => void,
): void {
  const peer = store.readPeer();
  const i = peer.findIndex((r) => r.id === row.id);
  if (i < 0) return;

  row.sent = true;
  row.sentAt = new Date().toISOString();
  row.deliverPane = "backlog";
  row.deliverMode = "idle";
  peer[i] = row;
  store.writePeer(peer);

  const entry: PeerBacklogRow = {
    ...row,
    status: "backlog",
    backlogAt: new Date().toISOString(),
    holdReason,
  };
  const backlog = readBacklog(store);
  backlog.push(entry);
  writeBacklog(store, backlog);
  log(`PEER backlog id=${row.id} -> ${row.targetLabel} reason=${holdReason}`);
}

export function countPeerBacklog(store: QueueStore): number {
  return readBacklog(store).length;
}

export function pendingPeerRows(store: QueueStore): PeerRow[] {
  return store.readPeer().filter((r) => !isPeerDelivered(r));
}

import fs from "node:fs";
import type { ProviderRegistry } from "@seat-mesh/core";
import { PEER_BULK_MAX, isAckClassPeer } from "@seat-mesh/core";
import { capturePaneSnapshot, tmux } from "@seat-mesh/tmux";
import type { QueueStore, PeerRow } from "../store/create-queue-store.js";
import { isPeerDelivered, peerSentToken } from "../store/create-queue-store.js";
import { isThinRoomUnseenPing } from "./peer-skip.js";
import { paneInDeliveryHold } from "../inject/pane-hold.js";
import { inboxSkipTypingGate } from "../inject/compose-gate.js";

export { isAckClassPeer } from "@seat-mesh/core";

export interface PeerBacklogRow extends PeerRow {
  status: "backlog";
  backlogAt: string;
  holdReason: string;
}

const BUSY_HOLD = /^held:(busy|typing)/;

/** Park inbound while the pane is busy/typing/empty-seat. Only PRIORITY / STOP other work pastes. */
export function shouldBacklogPeerHold(reason: string, msg: string): boolean {
  if (/\bPRIORITY\b|\bSTOP other work\b/i.test(msg)) return false;
  if (BUSY_HOLD.test(reason)) return true;
  // No live agent CLI yet — keep until Composer/Claude/OC loads (do not skip-drop).
  if (/^held:(plain_shell|plain_pane|limit|no_provider|target-unresolved)$/.test(reason)) {
    return true;
  }
  if (/^held:cotyped:/.test(reason)) return true;
  if (/^held:coord:(wait-busy|wait-typing)/.test(reason)) return true;
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
  // Keep latest entry per id (re-parks used to append forever).
  const byId = new Map<string, PeerBacklogRow>();
  for (const r of rows) byId.set(r.id, r);
  const deduped = [...byId.values()].sort((a, b) => a.backlogAt.localeCompare(b.backlogAt));
  const p = peerBacklogPath(store);
  fs.writeFileSync(
    p,
    deduped.map((r) => JSON.stringify(r)).join("\n") + (deduped.length ? "\n" : ""),
  );
}

function paneStatusMark(paneId: string): string {
  return (
    tmux(["display-message", "-t", paneId, "-p", "#{@mesh_status}"]).out?.trim() ?? ""
  );
}

function cursorFollowUpOpen(paneId: string, registry: ProviderRegistry): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov) return false;
  if (prov.id !== "cursor-agent" && prov.id !== "agent") return false;
  const st = prov.composerState(snap);
  return (
    st.busyLabel === "follow-up" || /Add a follow-up|ctrl\+c to stop/.test(snap.captureTail)
  );
}

function paneIdleForPromote(paneId: string, registry: ProviderRegistry): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov) return false;
  const st = prov.composerState(snap);
  // Empty zsh / rate wall — keep backlog; never promote until a real CLI loads.
  if (st.phase === "plain_shell" || st.phase === "limit") return false;
  // Prove / operator bypass — promote so drain can DIGEST-paste under skipTypingGate.
  if (inboxSkipTypingGate()) return true;

  // Recent hold (typing/busy) — do not promote until the backoff expires.
  if (paneInDeliveryHold(paneId)) return false;
  const mark = paneStatusMark(paneId);
  // Banner already knows typing/busy — do not capture-pane (lags the live composer).
  if (/\btyping\b/i.test(mark)) return false;
  if (/\bBUSY\b/i.test(mark) && !cursorFollowUpOpen(paneId, registry)) return false;
  if (st.phase === "typing" || st.phase === "busy") return false;
  if (st.phase === "empty" || st.phase === "afk") return true;
  return cursorFollowUpOpen(paneId, registry);
}

/** Rows marked backlog on PEER.jsonl but missing from PEER-BACKLOG.jsonl (inbox restart, etc.). */
function reconcileBacklogOrphans(store: QueueStore, log: (line: string) => void): number {
  const backlog = readBacklog(store);
  const ids = new Set(backlog.map((r) => r.id));
  let fixed = 0;
  const peer = store.readPeer();
  for (const row of peer) {
    if (row.deliverPane !== "backlog" || ids.has(row.id)) continue;
    const entry: PeerBacklogRow = {
      ...row,
      status: "backlog",
      backlogAt: row.sentAt ?? new Date().toISOString(),
      holdReason: "reconcile-orphan",
    };
    backlog.push(entry);
    ids.add(row.id);
    fixed++;
    log(`PEER backlog reconcile orphan id=${row.id} -> ${row.targetLabel}`);
  }
  if (fixed) writeBacklog(store, backlog);
  return fixed;
}

/** Drop already-pasted backlog rows (do not revive with sent:false — that re-injects). */
function finalizeAlreadyInjected(
  peer: PeerRow[],
  row: PeerBacklogRow,
  log: (line: string) => void,
): void {
  const pane = row.injectedPane || row.targetPane;
  const at = row.injectedAt || row.sentAt || new Date().toISOString();
  const done: PeerRow = {
    ...row,
    sent: true,
    sentAt: at,
    deliverPane: pane,
    deliverMode: row.deliverMode ?? "steer",
    injectedPane: row.injectedPane || pane,
    injectedAt: row.injectedAt || at,
  };
  const existing = peer.findIndex((r) => r.id === row.id);
  if (existing >= 0) peer[existing] = done;
  else peer.push(done);
  log(`PEER backlog drop-already-injected id=${row.id} -> ${row.targetLabel} pane=${pane}`);
}

/** Re-queue up to PEER_BULK_MAX backlog rows per idle pane per tick (DIGEST batch). */
export function promotePeerBacklog(
  store: QueueStore,
  registry: ProviderRegistry,
  log: (line: string) => void,
): number {
  reconcileBacklogOrphans(store, log);
  const backlog = readBacklog(store);
  if (!backlog.length) return 0;

  const peer = store.readPeer();
  const deliveredTokens = new Set(
    peer
      .filter((r) => isPeerDelivered(r))
      .map((r) => peerSentToken(r.msg))
      .filter((t): t is string => Boolean(t)),
  );

  const byPane = new Map<string, PeerBacklogRow[]>();
  for (const row of backlog) {
    const list = byPane.get(row.targetPane) ?? [];
    list.push(row);
    byPane.set(row.targetPane, list);
  }

  let promoted = 0;
  let dropped = 0;
  const kept: PeerBacklogRow[] = [];
  let peerDirty = false;

  for (const [, rows] of byPane) {
    rows.sort((a, b) => a.backlogAt.localeCompare(b.backlogAt));
    const paneId = rows[0]!.targetPane;

    // Always strip already-injected / dup-token / thin-room-unseen rows even while pane busy.
    const still: PeerBacklogRow[] = [];
    for (const row of rows) {
      const tok = peerSentToken(row.msg);
      if (row.injectedPane || row.injectedAt || (tok && deliveredTokens.has(tok))) {
        finalizeAlreadyInjected(peer, row, log);
        dropped++;
        peerDirty = true;
        if (tok) deliveredTokens.add(tok);
        continue;
      }
      if (isThinRoomUnseenPing(row)) {
        // Ledger SoT — drop stuck thin "N unseen" backlog (no promote/repark loop).
        const i = peer.findIndex((r) => r.id === row.id);
        if (i >= 0) {
          peer[i]!.sent = true;
          peer[i]!.sentAt = peer[i]!.sentAt ?? new Date().toISOString();
          peer[i]!.deliverPane = "skipped";
          peer[i]!.deliverMode = "idle";
          peerDirty = true;
        }
        log(`PEER backlog drop id=${row.id} -> ${row.targetLabel} reason=thin-room-unseen`);
        dropped++;
        continue;
      }
      still.push(row);
    }
    if (!still.length) continue;

    const followUpOnly = cursorFollowUpOpen(paneId, registry);
    if (!paneIdleForPromote(paneId, registry)) {
      kept.push(...still);
      continue;
    }
    // Follow-up steer: only ACK/FYI — never paste substance mid-turn.
    const eligible = followUpOnly
      ? still.filter((r) => isAckClassPeer(r.msg))
      : still;
    if (!eligible.length) {
      kept.push(...still);
      continue;
    }
    const restParked = followUpOnly
      ? still.filter((r) => !isAckClassPeer(r.msg))
      : [];
    // Promote up to DIGEST batch size so drain can one-paste ≤PEER_BULK_MAX.
    const take = eligible.slice(0, PEER_BULK_MAX);
    const restEligible = eligible.slice(PEER_BULK_MAX);
    for (const row of take) {
      const revived: PeerRow = {
        id: row.id,
        at: row.at,
        kind: row.kind,
        fromSlot: row.fromSlot,
        fromPorts: row.fromPorts,
        roomSlug: row.roomSlug,
        fromAgent: row.fromAgent,
        targetPane: row.targetPane,
        targetLabel: row.targetLabel,
        msg: row.msg,
        sent: false,
        injectedPane: row.injectedPane,
        injectedAt: row.injectedAt,
      };
      const existing = peer.findIndex((r) => r.id === row.id);
      if (existing >= 0) peer[existing] = revived;
      else peer.push(revived);
      promoted++;
      peerDirty = true;
      log(
        `PEER backlog promote id=${row.id} -> ${row.targetLabel}${followUpOnly ? " (ack-follow-up)" : ""}`,
      );
    }
    kept.push(...restEligible, ...restParked);
  }

  if (peerDirty) store.writePeer(peer);
  writeBacklog(store, kept);
  return promoted + dropped;
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

  // If already pasted once, do not re-park — that feeds promote→re-inject storms.
  if (row.injectedPane || row.injectedAt) {
    row.sent = true;
    row.sentAt = row.sentAt ?? row.injectedAt ?? new Date().toISOString();
    row.deliverPane = row.injectedPane || row.targetPane;
    peer[i] = row;
    store.writePeer(peer);
    const backlog = readBacklog(store).filter((r) => r.id !== row.id);
    writeBacklog(store, backlog);
    log(`PEER backlog skip-repark id=${row.id} -> ${row.targetLabel} (already injected)`);
    return;
  }

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
  // One row per id — re-park updates holdReason instead of bloating the file.
  const backlog = readBacklog(store).filter((r) => r.id !== row.id);
  backlog.push(entry);
  writeBacklog(store, backlog);
  log(`PEER backlog id=${row.id} -> ${row.targetLabel} reason=${holdReason}`);
}

export function countPeerBacklog(store: QueueStore): number {
  return readBacklog(store).length;
}

export function pendingPeerRows(store: QueueStore): PeerRow[] {
  // Backlog rows wait for promotePeerBacklog — do not re-drain every tick (capture spam / typing lag).
  return store.readPeer().filter((r) => !isPeerDelivered(r) && r.deliverPane !== "backlog");
}

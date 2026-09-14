/**
 * Group pending peer rows by pane and deliver up to PEER_BULK_MAX as one DIGEST.
 * patterns.md: one paste is the expensive part — agents reply-all in one turn.
 */
import {
  formatPeerBulkDigest,
  hubLockActive,
  isManagerKind,
  isSecretaryKind,
  openAcksForSeat,
  takePeerBulkBatch,
  type PeerBulkItem,
} from "@seat-mesh/core";
import { markColdStartDelivered, paneMetaForPane } from "@seat-mesh/tmux";
import { openAckForDeliveredPeer } from "../ack/ack-sweep.js";
import { deliverToPane } from "../inject/inject-delivery.js";
import { notePaneDeliveryHold, paneInDeliveryHold } from "../inject/pane-hold.js";
import type { MeshOrchestratorCtx } from "../orchestrator/mesh-orchestrator.js";
import {
  isAckClassPeer,
  parkPeerToBacklog,
  shouldBacklogPeerHold,
} from "./peer-backlog.js";
import { armRecipientCheckbackAfterPeer } from "./peer-comms-checkback.js";
import {
  isThinRoomUnseenPing,
  markPeerRowSkipped,
  shouldSkipDeliveredColdStart,
  shouldSkipDuplicateColdStartResummon,
  shouldSkipGlobalWorkerRoomPing,
  shouldSkipManagerStatusRoomPing,
} from "./peer-skip.js";
import { refreshPeerTargetPane } from "./peer-target-resolve.js";
import type { PeerRow } from "../store/create-queue-store.js";

const PEER_SKIP_REASONS = new Set(["no_snapshot"]);

export type GateFn = (
  ctx: MeshOrchestratorCtx,
  paneId: string,
  opts?: { isColdStart?: boolean },
) => { blocked: boolean; reason?: string };

function fromLabel(row: PeerRow): string {
  if (row.fromAgent?.trim()) return row.fromAgent.trim();
  if (row.kind === "room" || row.kind === "prompt" || row.kind === "remind") {
    return row.fromSlot;
  }
  if (/^\d+$/.test(row.fromSlot)) return `slot-${row.fromSlot}`;
  return row.fromSlot || "?";
}

function seatForRow(row: PeerRow): string {
  const meta = paneMetaForPane(row.targetPane);
  if (meta?.role) {
    if (meta.role === "worker" && meta.slot) return `worker-${meta.slot}`;
    if ((meta.role === "manager-mini" || meta.role === "mini") && meta.mini) {
      return `mini-${meta.mini}`;
    }
    return meta.role;
  }
  return row.targetLabel || "unknown";
}

function matchAckId(ctx: MeshOrchestratorCtx, seat: string, row: PeerRow): string | undefined {
  const ask = row.msg.replace(/\s+/g, " ").trim().slice(0, 200);
  const hit = openAcksForSeat(ctx.store.readAcks(), seat).find((a) => {
    if (a.ask === ask) return true;
    if (ask.includes(a.ask) || a.ask.includes(ask.slice(0, 80))) return true;
    return false;
  });
  return hit?.id;
}

function applySkips(ctx: MeshOrchestratorCtx, row: PeerRow): boolean {
  if (shouldSkipDeliveredColdStart(row)) {
    markPeerRowSkipped(ctx.store, row);
    if (row.fromSlot === "mesh-cold-start") {
      markColdStartDelivered(ctx.loaded, row.targetPane);
    }
    ctx.log(
      `PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=cold-start-already-delivered`,
    );
    return true;
  }
  if (shouldSkipDuplicateColdStartResummon(row, ctx.loaded)) {
    markPeerRowSkipped(ctx.store, row);
    ctx.log(
      `PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=cold-start-resummon-dup`,
    );
    return true;
  }
  if (shouldSkipGlobalWorkerRoomPing(row)) {
    markPeerRowSkipped(ctx.store, row);
    ctx.log(`PEER skip id=${row.id} -> ${row.targetLabel} reason=global-worker-thin-fyi`);
    return true;
  }
  if (shouldSkipManagerStatusRoomPing(row)) {
    markPeerRowSkipped(ctx.store, row);
    ctx.log(`PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=manager-status-room`);
    return true;
  }
  if (
    hubLockActive(ctx.loaded.workspace) &&
    isAckClassPeer(row.msg) &&
    (isManagerKind(row.targetLabel) || isSecretaryKind(row.targetLabel))
  ) {
    markPeerRowSkipped(ctx.store, row);
    ctx.log(`PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=hub-lock`);
    return true;
  }
  return false;
}

function markDelivered(
  ctx: MeshOrchestratorCtx,
  row: PeerRow,
  paneId: string,
  mode: "idle" | "steer",
): PeerRow {
  const rows = ctx.store.readPeer();
  const i = rows.findIndex((r) => r.id === row.id);
  const at = new Date().toISOString();
  if (i >= 0) {
    rows[i]!.sent = true;
    rows[i]!.sentAt = at;
    rows[i]!.deliverPane = paneId;
    rows[i]!.deliverMode = mode;
    rows[i]!.injectedPane = paneId;
    rows[i]!.injectedAt = at;
    ctx.store.writePeer(rows);
    return rows[i]!;
  }
  return {
    ...row,
    sent: true,
    sentAt: at,
    deliverPane: paneId,
    deliverMode: mode,
    injectedPane: paneId,
    injectedAt: at,
  };
}

function markSkipped(ctx: MeshOrchestratorCtx, row: PeerRow, reason: string): void {
  const rows = ctx.store.readPeer();
  const i = rows.findIndex((r) => r.id === row.id);
  if (i >= 0) {
    rows[i]!.sent = true;
    rows[i]!.sentAt = new Date().toISOString();
    rows[i]!.deliverPane = "skipped";
    rows[i]!.deliverMode = "idle";
    ctx.store.writePeer(rows);
  }
  if (row.fromSlot === "mesh-cold-start") {
    markColdStartDelivered(ctx.loaded, row.targetPane);
  }
  ctx.log(`PEER skip id=${row.id} -> ${row.targetLabel} reason=${reason}`);
}

/** Gate blocked: note hold; thin room skip; never park (parity with solo drain). */
function holdGateBatch(ctx: MeshOrchestratorCtx, batch: PeerRow[], reason: string): number {
  notePaneDeliveryHold(batch[0]!.targetPane, reason);
  let held = 0;
  for (const row of batch) {
    if (isThinRoomUnseenPing(row)) {
      markPeerRowSkipped(ctx.store, row);
      ctx.log(
        `PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=thin-room-busy:${reason}`,
      );
      continue;
    }
    ctx.log(`PEER held id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=${reason}`);
    held++;
  }
  return held;
}

/** Inject fail: park when shouldBacklogPeerHold; else hold. */
function holdOrParkInjectFail(
  ctx: MeshOrchestratorCtx,
  batch: PeerRow[],
  reason: string,
): number {
  notePaneDeliveryHold(batch[0]!.targetPane, reason);
  let held = 0;
  for (const row of batch) {
    if (shouldBacklogPeerHold(reason, row.msg)) {
      if (isThinRoomUnseenPing(row)) {
        markPeerRowSkipped(ctx.store, row);
        ctx.log(
          `PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=thin-room-no-backlog:${reason}`,
        );
        continue;
      }
      parkPeerToBacklog(ctx.store, row, reason, ctx.log);
      continue;
    }
    ctx.log(`PEER held id=${row.id} reason=${reason}`);
    held++;
  }
  return held;
}

export function refreshAndGroupPeers(
  ctx: MeshOrchestratorCtx,
  pending: PeerRow[],
): { byPane: Map<string, PeerRow[]>; held: number } {
  let held = 0;
  const byPane = new Map<string, PeerRow[]>();
  for (const row of pending) {
    if (row.sent && !row.sentAt) {
      ctx.log(`PEER forge-reset id=${row.id} (sent:true without proof)`);
      row.sent = false;
    }
    const { paneId: livePane, rerouted, unresolved } = refreshPeerTargetPane(ctx.loaded, row);
    if (unresolved) {
      ctx.log(
        `PEER held id=${row.id.slice(0, 8)} -> ${row.targetLabel || row.targetPane} reason=target-unresolved`,
      );
      held++;
      continue;
    }
    if (rerouted) {
      ctx.log(
        `PEER reroute id=${row.id.slice(0, 8)} ${row.targetLabel} ${row.targetPane}->${livePane}`,
      );
      row.targetPane = livePane;
      const all = ctx.store.readPeer();
      const ri = all.findIndex((r) => r.id === row.id);
      if (ri >= 0) {
        all[ri]!.targetPane = livePane;
        ctx.store.writePeer(all);
      }
    }
    if (applySkips(ctx, row)) continue;
    const list = byPane.get(row.targetPane) ?? [];
    list.push(row);
    byPane.set(row.targetPane, list);
  }
  return { byPane, held };
}

export function drainPeerPaneBulk(
  ctx: MeshOrchestratorCtx,
  paneId: string,
  rows: PeerRow[],
  gateDelivery: GateFn,
  injectedThisTick: Set<string>,
): { attempted: number; delivered: number; held: number } {
  if (!rows.length) return { attempted: 0, delivered: 0, held: 0 };
  if (paneInDeliveryHold(paneId) || injectedThisTick.has(paneId)) {
    return { attempted: 0, delivered: 0, held: rows.length };
  }

  // Cold-start / thin-room: never fold into DIGEST — first row only, solo.
  const soloFirst =
    rows[0]!.fromSlot === "mesh-cold-start" || isThinRoomUnseenPing(rows[0]!);
  const { batch } = soloFirst
    ? { batch: [rows[0]!] }
    : takePeerBulkBatch(rows);

  const isColdStart = batch.some((r) => r.fromSlot === "mesh-cold-start");
  const gate = gateDelivery(ctx, paneId, { isColdStart });
  if (gate.blocked) {
    const held = holdGateBatch(ctx, batch, gate.reason ?? "hold");
    return { attempted: 1, delivered: 0, held: held || batch.length };
  }

  const seat = seatForRow(batch[0]!);
  const thinRoomPing = batch.length === 1 && isThinRoomUnseenPing(batch[0]!);
  const roomPing = batch.every((r) => r.kind === "room");
  const toManager =
    isManagerKind(batch[0]!.targetLabel) ||
    batch[0]!.targetLabel === "master" ||
    isManagerKind(paneMetaForPane(paneId)?.role ?? "");

  // Single-item: keep original body (no DIGEST wrapper).
  const useBulk = batch.length > 1;
  const payload = useBulk
    ? formatPeerBulkDigest({
        seat,
        items: batch.map(
          (r): PeerBulkItem => ({
            from: fromLabel(r),
            body: r.msg,
            ackId: matchAckId(ctx, seat, r),
          }),
        ),
        more: Math.max(0, rows.length - batch.length),
      })
    : batch[0]!.msg;

  const lightweight = batch.every((r) => isAckClassPeer(r.msg) || r.kind === "room");
  const result = deliverToPane(paneId, payload, ctx.registry, {
    lightweight,
    roomPing: thinRoomPing || (roomPing && !toManager),
    loaded: ctx.loaded,
    workspace: ctx.loaded.workspace,
  });

  if (!result.ok) {
    if (PEER_SKIP_REASONS.has(result.reason)) {
      for (const row of batch) markSkipped(ctx, row, result.reason);
      return { attempted: 1, delivered: 0, held: 0 };
    }
    const held = holdOrParkInjectFail(ctx, batch, result.reason);
    return { attempted: 1, delivered: 0, held: held || batch.length };
  }

  injectedThisTick.add(paneId);
  let delivered = 0;
  for (const row of batch) {
    const done = markDelivered(ctx, row, paneId, result.mode);
    armRecipientCheckbackAfterPeer(ctx.store, ctx.loaded, done);
    openAckForDeliveredPeer(ctx, done);
    if (row.fromSlot === "mesh-cold-start") {
      markColdStartDelivered(ctx.loaded, paneId);
    }
    delivered++;
  }
  ctx.log(
    useBulk
      ? `PEER inject bulk=${batch.length} -> ${batch[0]!.targetLabel} provider=${result.providerId} mode=${result.mode}`
      : `PEER inject ${batch[0]!.kind} -> ${batch[0]!.targetLabel} from ${fromLabel(batch[0]!)} provider=${result.providerId} mode=${result.mode}`,
  );
  return { attempted: 1, delivered, held: 0 };
}

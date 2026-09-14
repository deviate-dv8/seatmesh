/**
 * ACK ledger drain — open on ask, clear on filing, remind while open.
 *
 * Flood case this catches: seat is mid-task, inbox/peer dumps land, agent answers
 * the newest turn in chat and never files (or never returns to) the earlier ask.
 * Open rows stay visible in ACK.jsonl + banner until cleared; reminders re-inject.
 */
import {
  type AckRow,
  ACK_REMIND_MAX,
  ackRemindDelaySec,
  formatAckReminder,
  matchFiledAcks,
  openAcks,
  remindableAcks,
  type SeatFiling,
} from "@seat-mesh/core";
import { tmux } from "@seat-mesh/tmux";
import { deliverToPane } from "../inject/inject-delivery.js";
import { notePaneDeliveryHold, paneInDeliveryHold } from "../inject/pane-hold.js";
import type { MeshOrchestratorCtx } from "../orchestrator/mesh-orchestrator.js";
import {
  openAckForInboxRow,
  openAckForPeerRow,
} from "./ack-open.js";
import { drainOperatorPrompts, noteDaemonInject } from "./ack-watch.js";

export { openAckForInboxRow, openAckForPeerRow } from "./ack-open.js";

function paneStatusMark(paneId: string): string {
  return tmux(["display-message", "-t", paneId, "-p", "#{@mesh_status}"]).out?.trim() ?? "";
}

function paneLooksBusyForRemind(paneId: string): boolean {
  if (paneInDeliveryHold(paneId)) return true;
  const mark = paneStatusMark(paneId);
  return /\btyping\b|\bBUSY\b/i.test(mark);
}

export function openAckForDeliveredPeer(
  ctx: MeshOrchestratorCtx,
  row: Parameters<typeof openAckForPeerRow>[1],
): void {
  openAckForPeerRow(ctx.store, row, ctx.log);
  const pane =
    row.deliverPane && row.deliverPane.startsWith("%") ? row.deliverPane : row.targetPane;
  if (pane.startsWith("%")) noteDaemonInject(pane);
}

export function openAckForDeliveredInbox(
  ctx: MeshOrchestratorCtx,
  row: Parameters<typeof openAckForInboxRow>[1],
  lane: "secretary" | "manager",
  paneId: string,
): void {
  openAckForInboxRow(ctx.store, row, lane, paneId, ctx.log);
}

/** Operator prompts detected by border-paint composer watch. */
export function openAcksFromOperatorPrompts(ctx: MeshOrchestratorCtx): number {
  const prompts = drainOperatorPrompts();
  let n = 0;
  for (const p of prompts) {
    const opened = ctx.store.openAck({
      seat: p.label,
      paneId: p.paneId,
      source: "operator",
      ask: p.prompt,
      at: p.at,
    });
    ctx.log(`ACK open id=${opened.id.slice(0, 10)} seat=${opened.seat} source=operator`);
    n++;
  }
  return n;
}

function filingsSince(ctx: MeshOrchestratorCtx, sinceIso: string): SeatFiling[] {
  const since = Date.parse(sinceIso) || 0;
  const out: SeatFiling[] = [];

  for (const row of ctx.store.readPeer()) {
    if (!row.sentAt || Date.parse(row.sentAt) < since) continue;
    if (row.deliverPane === "skipped" || row.deliverPane === "backlog") continue;
    const seat =
      row.fromAgent?.trim() ||
      (row.kind === "room"
        ? row.fromSlot
        : /^\d+$/.test(row.fromSlot)
          ? `worker-${row.fromSlot}`
          : row.fromSlot);
    if (!seat || seat === "mesh-cold-start") continue;
    out.push({
      seat,
      at: row.sentAt,
      what: `peer -> ${row.targetLabel || row.targetPane}`,
    });
  }

  for (const row of ctx.store.readInbox()) {
    if (!row.sentAt || Date.parse(row.sentAt) < since) continue;
    const seat = row.from?.trim() || (row.slot ? `worker-${row.slot}` : "");
    if (!seat) continue;
    out.push({
      seat,
      at: row.sentAt,
      what: `inbox -> ${row.deliveredTo ?? "coord"}`,
    });
  }

  return out;
}

/** Close open rows when the seat filed something after the ask. */
export function closeAcksOnFilings(ctx: MeshOrchestratorCtx): number {
  const rows = ctx.store.readAcks();
  const open = openAcks(rows);
  if (!open.length) return 0;
  const oldest = open.reduce((a, b) => (a.at < b.at ? a : b)).at;
  const matched = matchFiledAcks(rows, filingsSince(ctx, oldest));
  let n = 0;
  for (const { row, note } of matched) {
    const res = ctx.store.ackAck(row.id, "filed", note);
    if (res.ok) {
      ctx.log(`ACK filed id=${row.id.slice(0, 10)} seat=${row.seat} note=${note}`);
      n++;
    }
  }
  return n;
}

function dueForRemind(row: AckRow, nowMs: number): boolean {
  if (row.reminders >= ACK_REMIND_MAX) return false;
  const delay = ackRemindDelaySec(row.reminders) * 1000;
  const base = Date.parse(row.remindedAt ?? row.at) || 0;
  return nowMs - base >= delay;
}

/** Re-inject unanswered asks (batched per seat). */
export function fireAckReminders(ctx: MeshOrchestratorCtx): number {
  const now = Date.now();
  const bySeat = new Map<string, AckRow[]>();
  for (const row of remindableAcks(ctx.store.readAcks())) {
    if (!dueForRemind(row, now)) continue;
    const list = bySeat.get(row.seat) ?? [];
    list.push(row);
    bySeat.set(row.seat, list);
  }

  let fired = 0;
  for (const [seat, seatRows] of bySeat) {
    const pane = seatRows[0]?.paneId;
    if (!pane) continue;
    if (paneLooksBusyForRemind(pane)) {
      // Push due clock without burning a reminder slot — avoid deliver/capture spam.
      const all = ctx.store.readAcks();
      const nowIso = new Date().toISOString();
      for (const row of seatRows) {
        const hit = all.find((a) => a.id === row.id);
        if (!hit || hit.ackedAt) continue;
        hit.remindedAt = nowIso;
      }
      ctx.store.writeAcks(all);
      notePaneDeliveryHold(pane, "held:typing");
      continue;
    }
    const msg = formatAckReminder(seat, seatRows);
    if (!msg) continue;
    const r = deliverToPane(pane, msg, ctx.registry, {
      skipVerify: true,
      intent: "ack-remind",
      loaded: ctx.loaded,
      workspace: ctx.loaded.workspace,
    });
    if (!r.ok) {
      notePaneDeliveryHold(pane, r.reason);
      const all = ctx.store.readAcks();
      const nowIso = new Date().toISOString();
      for (const row of seatRows) {
        const hit = all.find((a) => a.id === row.id);
        if (!hit || hit.ackedAt) continue;
        hit.remindedAt = nowIso;
      }
      ctx.store.writeAcks(all);
      ctx.log(`ACK remind held seat=${seat} reason=${r.reason}`);
      continue;
    }
    noteDaemonInject(pane);
    const all = ctx.store.readAcks();
    const nowIso = new Date().toISOString();
    for (const row of seatRows) {
      const hit = all.find((a) => a.id === row.id);
      if (!hit || hit.ackedAt) continue;
      hit.reminders += 1;
      hit.remindedAt = nowIso;
    }
    ctx.store.writeAcks(all);
    ctx.log(`ACK remind seat=${seat} n=${seatRows.length} pane=${pane}`);
    fired++;
  }
  return fired;
}

/** One orchestrator tick worth of ACK bookkeeping. */
export function ackSweepTick(ctx: MeshOrchestratorCtx): void {
  openAcksFromOperatorPrompts(ctx);
  closeAcksOnFilings(ctx);
  fireAckReminders(ctx);
}

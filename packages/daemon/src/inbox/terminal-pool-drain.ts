import fs from "node:fs";
import path from "node:path";
import { meshRuntimePaths, type LoadedProfile, type TpJobRow } from "@seat-mesh/core";
import type { PeerRow } from "../store/jsonl-store.js";
import type { QueueStore } from "../store/create-queue-store.js";
import type { TpPtyPool } from "./terminal-pool-pty.js";

const TP_DEFAULT_CONCURRENT = 2;
const TP_MAX_CONCURRENT_CAP = 8;

export interface TerminalPoolDrainCtx {
  loaded: LoadedProfile;
  store: QueueStore;
  log: (line: string) => void;
  appendPeer: (row: PeerRow) => void;
  scheduleDrain: () => void;
  /** From mesh.config.yaml daemon.terminalPool.concurrency (default 2). */
  maxConcurrent?: number;
  /** PTY worker pool — interactive attach via /ws/tp. */
  ptyPool?: TpPtyPool;
}

function tpMaxConcurrent(ctx: TerminalPoolDrainCtx): number {
  const raw = ctx.maxConcurrent ?? ctx.ptyPool?.workerCount ?? TP_DEFAULT_CONCURRENT;
  return Math.max(1, Math.min(TP_MAX_CONCURRENT_CAP, raw));
}

export function tpRunningCount(ctx?: TerminalPoolDrainCtx): number {
  if (ctx?.ptyPool) {
    return ctx.ptyPool.snapshots().filter((w) => w.status === "running").length;
  }
  return 0;
}

export function enqueueTpJob(
  store: QueueStore,
  input: {
    requesterSeat: string;
    requesterPane: string;
    cmd: string;
    cwd?: string;
    summary?: string;
    interactive?: boolean;
  },
): TpJobRow {
  const row: TpJobRow = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    requesterSeat: input.requesterSeat.trim(),
    requesterPane: input.requesterPane.trim(),
    cmd: input.cmd.trim(),
    cwd: input.cwd?.trim() || undefined,
    summary: input.summary?.trim() || undefined,
    interactive: input.interactive !== false,
    status: "pending",
  };
  store.appendTpJob(row);
  return row;
}

export function tpQueueAhead(store: QueueStore, excludeId?: string): number {
  return store
    .readTpJobs()
    .filter(
      (r) =>
        (r.status === "pending" || r.status === "running") && (!excludeId || r.id !== excludeId),
    ).length;
}

/** Non-blocking: assign pending jobs to idle PTY workers. */
export function kickTerminalPool(ctx: TerminalPoolDrainCtx): void {
  if (!ctx.ptyPool) {
    ctx.log("TP skip — pty pool not initialized");
    return;
  }

  const running = tpRunningCount(ctx);
  const cap = tpMaxConcurrent(ctx);
  if (running >= cap) return;

  while (tpRunningCount(ctx) < cap) {
    const row = ctx.store.readTpJobs().find((r) => r.status === "pending");
    if (!row) return;

    row.status = "running";
    row.startedAt = new Date().toISOString();
    ctx.store.updateTpJob(row);
    ctx.log(
      `TP start ${row.id.slice(0, 8)} seat=${row.requesterSeat} worker-pending — ${row.summary ?? row.cmd.slice(0, 60)}`,
    );

    const started = ctx.ptyPool.startJob(ctx, row);
    if (!started) {
      row.status = "pending";
      row.startedAt = undefined;
      ctx.store.updateTpJob(row);
      return;
    }
  }
}

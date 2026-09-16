import type { LoadedProfile, PaneOpRow, ProviderRegistry } from "@seat-mesh/core";
import { executePaneOp, saveMeshSession } from "@seat-mesh/tmux";
import type { QueueStore } from "../store/create-queue-store.js";

export interface PaneOpsDrainCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  store: QueueStore;
  log: (line: string) => void;
  isBusy: () => boolean;
  setBusy: (v: boolean) => void;
}

const STALE_RUNNING_MS = 10 * 60 * 1000;

/** Daemon restart mid-op leaves rows stuck in `running` — reclaim so queue can drain. */
export function reclaimStaleRunningPaneOps(
  store: QueueStore,
  log: (line: string) => void,
  staleMs = STALE_RUNNING_MS,
): number {
  let n = 0;
  for (const row of store.readPaneOps()) {
    if (row.status !== "running") continue;
    const started = Date.parse(row.at);
    if (!Number.isFinite(started) || Date.now() - started < staleMs) continue;
    row.status = "failed";
    row.error = "stale running (reclaimed on drain)";
    row.finishedAt = new Date().toISOString();
    store.updatePaneOp(row);
    log(`PANE-OP reclaim stale ${row.id.slice(0, 8)} ${row.kind}`);
    n++;
  }
  return n;
}

export function drainPaneOpsOnce(ctx: PaneOpsDrainCtx): boolean {
  if (ctx.isBusy()) return false;

  reclaimStaleRunningPaneOps(ctx.store, ctx.log);
  const rows = ctx.store.readPaneOps();
  const row =
    rows.find((r) => r.status === "pending" && r.kind === "secretary-restart") ??
    rows.find((r) => r.status === "pending");
  if (!row) return false;

  ctx.setBusy(true);
  row.status = "running";
  ctx.store.updatePaneOp(row);
  ctx.log(`PANE-OP start ${row.id.slice(0, 8)} ${row.kind} who=${row.who} — ${row.summary}`);

  const result = executePaneOp(ctx.loaded, row);
  row.finishedAt = new Date().toISOString();
  if (result.ok) {
    row.status = "done";
    ctx.log(`PANE-OP done ${row.id.slice(0, 8)} ${row.kind}`);
  } else {
    row.status = "failed";
    row.error = result.error;
    ctx.log(`PANE-OP fail ${row.id.slice(0, 8)} ${row.kind}: ${result.error ?? "?"}`);
  }
  ctx.store.updatePaneOp(row);
  if (result.ok) {
    try {
      const saved = saveMeshSession(ctx.loaded, ctx.registry);
      ctx.log(`PANE-OP saved ${saved}`);
    } catch (e) {
      ctx.log(`PANE-OP save warn: ${(e as Error).message}`);
    }
  }
  ctx.setBusy(false);
  return true;
}

export function enqueuePaneOp(
  store: QueueStore,
  kind: PaneOpRow["kind"],
  who: string,
  summary: string,
  payload: Record<string, unknown>,
): PaneOpRow {
  const row: PaneOpRow = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    who,
    summary,
    payload,
    status: "pending",
  };
  store.appendPaneOp(row);
  return row;
}

export function queueAheadCount(store: QueueStore): number {
  return store.readPaneOps().filter((r) => r.status === "pending" || r.status === "running").length;
}

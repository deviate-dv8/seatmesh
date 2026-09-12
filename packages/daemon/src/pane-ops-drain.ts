import type { LoadedProfile, PaneOpRow, ProviderRegistry } from "seat-mesh-core";
import { executePaneOp, saveMeshSession } from "seat-mesh-tmux";
import type { QueueStore } from "./create-queue-store.js";

export interface PaneOpsDrainCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  store: QueueStore;
  log: (line: string) => void;
  isBusy: () => boolean;
  setBusy: (v: boolean) => void;
}

export function drainPaneOpsOnce(ctx: PaneOpsDrainCtx): boolean {
  if (ctx.isBusy()) return false;

  const rows = ctx.store.readPaneOps();
  const row = rows.find((r) => r.status === "pending");
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

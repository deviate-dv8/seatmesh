import { chatFileConfigForLoaded, recordComposerDraftsForPanes } from "@seat-mesh/core";
import { batchCapturePaneSnapshots, listMeshMonitorPanes } from "@seat-mesh/tmux";
import type { MeshOrchestratorCtx } from "../orchestrator/mesh-orchestrator.js";

const SCAN_INTERVAL_MS = 8000;
let lastScanAt = 0;

/** Periodic scan so unsent follow-ups / pending survive agent crashes. */
export function maybeScanComposerDrafts(ctx: MeshOrchestratorCtx): void {
  const now = Date.now();
  if (now - lastScanAt < SCAN_INTERVAL_MS) return;
  lastScanAt = now;
  void scanComposerDrafts(ctx).catch((err) => {
    ctx.log(`chat-draft scan err ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function scanComposerDrafts(ctx: MeshOrchestratorCtx): Promise<void> {
  const panes = listMeshMonitorPanes(
    ctx.session,
    ctx.baseWindow,
    ctx.workersWindow,
    ctx.minisWindow,
  );
  if (!panes.length) return;

  const paneIds = panes.map((p) => p.paneId);
  const batch = batchCapturePaneSnapshots(ctx.session, { paneIds, tailLines: 48 });
  const snaps = paneIds.map((id) => batch.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  if (!snaps.length) return;

  const cfg = chatFileConfigForLoaded(ctx.loaded);
  const n = await recordComposerDraftsForPanes(ctx.loaded.workspace, cfg, ctx.registry, snaps);
  if (n > 0) ctx.log(`chat-draft saved n=${n}`);
}

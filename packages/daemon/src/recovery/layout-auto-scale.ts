/**
 * Daemon auto scale workers/minis — grow when no free shells, shrink idle high slots.
 */
import type { LoadedProfile } from "@seat-mesh/core";
import {
  activityReasonsForMeta,
  listMeshMinis,
  listMeshWorkers,
  scaleLayout,
  resolveLiveTmuxSession,
  paneIsIdleShell,
} from "@seat-mesh/tmux";
import type { MeshPaneMeta } from "@seat-mesh/tmux";

export interface LayoutAutoScaleCtx {
  loaded: LoadedProfile;
  log: (line: string) => void;
}

let lastScaleAt = 0;

function isFreeEmpty(loaded: LoadedProfile, meta: MeshPaneMeta): boolean {
  if (!paneIsIdleShell(meta.paneId)) return false;
  return activityReasonsForMeta(loaded, meta).length === 0;
}

/** Count free empty worker shells (ready for spawn). */
export function countFreeWorkerShells(loaded: LoadedProfile): number {
  const session = resolveLiveTmuxSession(loaded);
  const win = loaded.profile.layout?.workers.window ?? "workers";
  return listMeshWorkers(session, win).filter((m) => isFreeEmpty(loaded, m)).length;
}

/** Highest worker slot that is free-empty (candidate for scale-down). */
function highestIdleWorker(loaded: LoadedProfile): MeshPaneMeta | null {
  const session = resolveLiveTmuxSession(loaded);
  const win = loaded.profile.layout?.workers.window ?? "workers";
  const rows = listMeshWorkers(session, win)
    .filter((m) => m.slot)
    .sort((a, b) => Number(b.slot) - Number(a.slot));
  for (const m of rows) {
    if (isFreeEmpty(loaded, m)) return m;
  }
  return null;
}

function highestIdleMini(loaded: LoadedProfile): MeshPaneMeta | null {
  const session = resolveLiveTmuxSession(loaded);
  const win = loaded.profile.layout?.minis.window ?? "minis";
  const rows = listMeshMinis(session, win)
    .filter((m) => m.mini)
    .sort((a, b) => Number(b.mini) - Number(a.mini));
  for (const m of rows) {
    if (isFreeEmpty(loaded, m)) return m;
  }
  return null;
}

/**
 * One auto-scale tick. Prefer scale-down one step when high slot idle;
 * else scale-up one step when zero free workers (and workers enabled).
 */
export function pollLayoutAutoScale(ctx: LayoutAutoScaleCtx): boolean {
  const as = ctx.loaded.profile.layout?.autoScale;
  if (!as?.enabled) return false;
  const cooldownMs = (as.cooldownSec ?? 120) * 1000;
  const now = Date.now();
  if (now - lastScaleAt < cooldownMs) return false;

  const workersEnabled = ctx.loaded.profile.layout?.workers.enabled !== false;
  const minisEnabled = ctx.loaded.profile.layout?.minis.enabled === true;

  try {
    // Down first — reclaim idle capacity.
    if (workersEnabled) {
      const cur = ctx.loaded.profile.layout?.workers.slots ?? ctx.loaded.profile.session.workerCount;
      const min = as.workers?.min ?? 1;
      if (cur > min && highestIdleWorker(ctx.loaded)) {
        const free = countFreeWorkerShells(ctx.loaded);
        // Only down when we have spare free shells (keep at least one free if possible).
        if (free >= 2 || (free >= 1 && cur > min + 0)) {
          const r = scaleLayout(ctx.loaded, { kind: "workers", dir: "down" });
          if (r.from !== r.to) {
            lastScaleAt = now;
            ctx.log(`AUTO-SCALE workers ${r.from} → ${r.to} (${r.grid}) [down]`);
            return true;
          }
        }
      }
    }

    if (minisEnabled) {
      const cur = ctx.loaded.profile.layout?.minis.max ?? ctx.loaded.profile.session.miniMax;
      const min = as.minis?.min ?? 1;
      if (cur > min && highestIdleMini(ctx.loaded)) {
        const session = resolveLiveTmuxSession(ctx.loaded);
        const win = ctx.loaded.profile.layout?.minis.window ?? "minis";
        const free = listMeshMinis(session, win).filter((m) => isFreeEmpty(ctx.loaded, m)).length;
        if (free >= 2) {
          const r = scaleLayout(ctx.loaded, { kind: "minis", dir: "down" });
          if (r.from !== r.to) {
            lastScaleAt = now;
            ctx.log(`AUTO-SCALE minis ${r.from} → ${r.to} (${r.grid}) [down]`);
            return true;
          }
        }
      }
    }

    // Up when no free worker shell left.
    if (workersEnabled) {
      const cur = ctx.loaded.profile.layout?.workers.slots ?? ctx.loaded.profile.session.workerCount;
      const max = as.workers?.max ?? 6;
      if (cur < max && countFreeWorkerShells(ctx.loaded) === 0) {
        const r = scaleLayout(ctx.loaded, { kind: "workers", dir: "up" });
        if (r.from !== r.to) {
          lastScaleAt = now;
          ctx.log(`AUTO-SCALE workers ${r.from} → ${r.to} (${r.grid}) [up]`);
          return true;
        }
      }
    }
  } catch (e) {
    ctx.log(`AUTO-SCALE skip: ${(e as Error).message}`);
  }
  return false;
}

import type { MeshProfile } from "../schema/profile.js";
import type { MeshAgents, SavedMinisLayout } from "../schema/agents.js";
import { gridPaneCapacity } from "../layout/minis.js";

/** Effective minis layout: saved mesh-agents.json wins over profile yaml defaults. */
export function effectiveMinisLayout(
  profile: MeshProfile,
  saved?: SavedMinisLayout | null,
): SavedMinisLayout {
  const base = profile.layout?.minis;
  if (!base) {
    throw new Error("profile missing layout.minis");
  }
  if (!saved) {
    return {
      grid: base.grid,
      max: base.max,
      leads: Array.isArray(base.leads) ? base.leads : [1, 2],
    };
  }
  return {
    grid: saved.grid,
    max: saved.max,
    leads: saved.leads,
  };
}

/** Merge saved mesh-agents layout into a loaded profile (session counts synced). */
export function mergeMeshAgentsIntoProfile(
  profile: MeshProfile,
  mesh: Pick<MeshAgents, "layout"> | null,
): MeshProfile {
  const saved = mesh?.layout;
  if (!saved || !profile.layout) return profile;

  const minisSaved = saved.minis;
  const minis = minisSaved
    ? { ...profile.layout.minis, ...minisSaved }
    : profile.layout.minis;

  let workers = saved.workers
    ? { ...profile.layout.workers, ...saved.workers }
    : profile.layout.workers;

  // Heal poisoned scrapes (e.g. grid 3x2 + slots 1) — prefer yaml when capacity mismatches.
  if (
    typeof workers.slots === "number" &&
    workers.slots > 0 &&
    gridPaneCapacity(workers.grid) !== workers.slots
  ) {
    if (gridPaneCapacity(profile.layout.workers.grid) === workers.slots) {
      workers = { ...workers, grid: profile.layout.workers.grid };
    } else {
      workers = {
        ...workers,
        grid: profile.layout.workers.grid,
        slots: profile.layout.workers.slots,
      };
    }
  }

  const nvim = saved.nvim ? { ...profile.layout.nvim, ...saved.nvim } : profile.layout.nvim;

  const logs = saved.logs
    ? { ...profile.layout.logs, ...saved.logs }
    : profile.layout.logs;

  const base = saved.base
    ? { ...profile.layout.base, ...saved.base }
    : profile.layout.base;

  const workerCount =
    typeof workers.slots === "number" && workers.slots > 0
      ? workers.slots
      : profile.session.workerCount;

  return {
    ...profile,
    layout: {
      ...profile.layout,
      base,
      nvim,
      workers,
      minis,
      logs,
    },
    session: {
      ...profile.session,
      miniMax: minis.max,
      workerCount,
    },
  };
}

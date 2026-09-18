/**
 * Scale workers / minis pane counts: patch yaml + mesh-agents, seat-init, relayout.
 */
/**
 * Scale workers / minis pane counts: patch yaml + mesh-agents, seat-init, relayout.
 */
import fs from "node:fs";
import {
  MeshAgentsSchema,
  gridForSlotCount,
  nextScaleCount,
  prevScaleCount,
  writeProfileFormPatch,
  loadProfile,
  type LoadedProfile,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import {
  loadMeshAgentsAt,
  meshAgentsJsonPath,
} from "../agents/agents-state.js";
import { saveMeshAgentsFile, saveMeshSession } from "./save-session.js";
import { ensureSeatFiles } from "../seats/seat-init.js";
import { assertRelayoutSafe } from "./layout-guard.js";
import { relayoutMeshSession } from "./session.js";

export type ScaleKind = "workers" | "minis";
export type ScaleDir = "up" | "down";

export interface ScaleLayoutOpts {
  kind: ScaleKind;
  /** Absolute target count, or omit when using dir. */
  to?: number;
  dir?: ScaleDir;
  force?: boolean;
  dryRun?: boolean;
  /** Floor / ceiling (defaults from layout.autoScale or 1..12). */
  min?: number;
  max?: number;
}

export interface ScaleLayoutResult {
  kind: ScaleKind;
  from: number;
  to: number;
  grid: string;
  dryRun: boolean;
  saved?: string;
}

function autoBounds(loaded: LoadedProfile, kind: ScaleKind): { min: number; max: number } {
  const as = loaded.profile.layout?.autoScale;
  if (kind === "workers") {
    return {
      min: as?.workers?.min ?? 1,
      max: as?.workers?.max ?? 12,
    };
  }
  return {
    min: as?.minis?.min ?? 1,
    max: as?.minis?.max ?? 8,
  };
}

function currentCount(loaded: LoadedProfile, kind: ScaleKind): number {
  if (kind === "workers") {
    return loaded.profile.layout?.workers.slots ?? loaded.profile.session.workerCount;
  }
  return loaded.profile.layout?.minis.max ?? loaded.profile.session.miniMax;
}

function resolveTarget(loaded: LoadedProfile, opts: ScaleLayoutOpts): number {
  const { min, max } = autoBounds(loaded, opts.kind);
  const lo = opts.min ?? min;
  const hi = opts.max ?? max;
  const cur = currentCount(loaded, opts.kind);
  let next: number;
  if (opts.to != null) {
    next = opts.to;
  } else if (opts.dir === "up") {
    next = nextScaleCount(cur, hi);
  } else if (opts.dir === "down") {
    next = prevScaleCount(cur, lo);
  } else {
    throw new Error("scale: need up|down or absolute count");
  }
  if (next < lo || next > hi) {
    throw new Error(`scale ${opts.kind}: ${next} outside ${lo}..${hi}`);
  }
  return next;
}

function patchMeshAgentsCounts(
  loaded: LoadedProfile,
  kind: ScaleKind,
  count: number,
  grid: string,
): void {
  const file = meshAgentsJsonPath(loaded);
  if (!fs.existsSync(file)) return;
  const mesh = loadMeshAgentsAt(file);
  if (!mesh) return;
  const layout = { ...(mesh.layout ?? {}) };
  if (kind === "workers") {
    layout.workers = {
      enabled: true,
      grid,
      slots: count,
    };
  } else {
    layout.minis = {
      ...(layout.minis ?? { leads: [1] }),
      enabled: true,
      grid,
      max: count,
      leads: layout.minis?.leads ?? [1],
    };
  }
  const next = MeshAgentsSchema.parse({
    ...mesh,
    layout,
    updatedAt: new Date().toISOString(),
  });
  saveMeshAgentsFile(file, next);
}

/** Scale workers or minis to a target count (or one step up/down). */
export function scaleLayout(loaded: LoadedProfile, opts: ScaleLayoutOpts): ScaleLayoutResult {
  const from = currentCount(loaded, opts.kind);
  const to = resolveTarget(loaded, opts);
  const grid = gridForSlotCount(to);
  if (from === to) {
    return { kind: opts.kind, from, to, grid, dryRun: Boolean(opts.dryRun) };
  }

  if (opts.dryRun) {
    return { kind: opts.kind, from, to, grid, dryRun: true };
  }

  const patch =
    opts.kind === "workers"
      ? {
          session: { workerCount: to },
          layout: {
            workers: { grid, slots: to, enabled: true },
          },
        }
      : {
          session: { miniMax: to },
          layout: {
            minis: { grid, max: to, enabled: true },
          },
        };

  writeProfileFormPatch(loaded.profilePath, patch);
  patchMeshAgentsCounts(loaded, opts.kind, to, grid);

  const nextLoaded = loadProfile(loaded.profileDir);
  ensureSeatFiles(nextLoaded);
  assertRelayoutSafe(nextLoaded, opts.force ?? false);
  relayoutMeshSession(nextLoaded, { force: opts.force, save: false });
  const reg = createRegistryForProfile(nextLoaded.profile);
  const saved = saveMeshSession(nextLoaded, reg);

  return { kind: opts.kind, from, to, grid, dryRun: false, saved };
}

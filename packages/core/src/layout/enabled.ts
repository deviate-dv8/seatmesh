import type { MeshLayout } from "../schema/layout.js";
import type { SavedLayout } from "../schema/agents.js";

export function nvimLayoutEnabled(layout: MeshLayout, saved?: SavedLayout | null): boolean {
  return saved?.nvim?.enabled ?? layout.nvim.enabled ?? false;
}

export function workersLayoutEnabled(layout: MeshLayout, saved?: SavedLayout | null): boolean {
  return saved?.workers?.enabled ?? layout.workers.enabled ?? false;
}

export function minisLayoutEnabled(layout: MeshLayout, saved?: SavedLayout | null): boolean {
  return saved?.minis?.enabled ?? layout.minis.enabled ?? false;
}

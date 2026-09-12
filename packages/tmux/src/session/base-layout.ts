import type { BaseColumn, LoadedProfile } from "@seat-mesh/core";
import { stampBaseColumn } from "./labels.js";
import { tmux } from "../lib/tmux-run.js";
import {
  meshManagerPane,
  meshSecretaryPane,
  paneMetaForPane,
} from "../lib/pane-meta.js";
import { listWindowPaneIds } from "./window-panes.js";

const DEFAULT_CLI: Record<BaseColumn, string> = {
  manager: "agent",
  "manager-2": "agent",
  secretary: "opencode",
};

export function baseColumns(loaded: LoadedProfile): BaseColumn[] {
  return loaded.profile.layout?.base.columns ?? ["manager", "secretary"];
}

/** @deprecated always ["manager"] — kept for call-site compat. */
export function managerStack(_loaded: LoadedProfile): BaseColumn[] {
  return ["manager"];
}

export function expectedBasePaneCount(loaded: LoadedProfile): number {
  return baseColumns(loaded).length;
}

export function cliForBaseColumn(loaded: LoadedProfile, col: BaseColumn): string {
  const override = loaded.profile.layout?.base.cli?.[col];
  return override ?? DEFAULT_CLI[col];
}

function secretaryWidthPct(loaded: LoadedProfile): number {
  return loaded.profile.layout?.base.secretaryWidthPct ?? 50;
}

function displayInt(paneOrTarget: string, format: string): number {
  const out = tmux(["display-message", "-p", "-t", paneOrTarget, format]).out.trim();
  const n = Number.parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

function killLegacyManagerBPanes(session: string, baseWin: string): void {
  for (const paneId of listWindowPaneIds(session, baseWin)) {
    const role = paneMetaForPane(paneId)?.role ?? "";
    if (role === "manager-b") {
      tmux(["kill-pane", "-t", paneId]);
    }
  }
}

/** Base layout: manager (left) + secretary (right). Idempotent at target pane count. */
export function ensureBaseLayout(loaded: LoadedProfile, session: string): string[] {
  const layout = loaded.profile.layout;
  if (!layout) return [];
  const baseWin = layout.base.window;
  const wantPanes = expectedBasePaneCount(loaded);

  killLegacyManagerBPanes(session, baseWin);
  let panes = listWindowPaneIds(session, baseWin);

  while (panes.length < wantPanes && panes.length > 0) {
    tmux(["split-window", "-h", "-t", panes[0]!, "-p", "50"]);
    panes = listWindowPaneIds(session, baseWin);
  }

  const cols = baseColumns(loaded);
  panes = listWindowPaneIds(session, baseWin);
  for (let i = 0; i < panes.length && i < cols.length; i++) {
    stampBaseColumn(panes[i]!, cols[i]!);
  }

  return panes;
}

/** Resize secretary column to profile ratio (no kill/respawn). */
export function realignBaseLayout(loaded: LoadedProfile, session: string): boolean {
  const layout = loaded.profile.layout;
  if (!layout) return false;

  const baseWin = layout.base.window;
  const target = `${session}:${baseWin}`;
  const mgrPane = meshManagerPane(session, baseWin);
  const secPane = meshSecretaryPane(session, baseWin);
  if (!mgrPane || !secPane) return false;

  const winW = displayInt(target, "#{window_width}");
  if (winW < 20) return false;

  const wantSecW = Math.max(20, Math.round((winW * secretaryWidthPct(loaded)) / 100));
  const curSecW = displayInt(secPane, "#{pane_width}");
  const dx = wantSecW - curSecW;
  if (dx === 0) return false;
  tmux(["resize-pane", "-t", secPane, "-x", String(dx)]);
  return true;
}

import type { BaseColumn, LoadedProfile } from "@seat-mesh/core";
import {
  baseColumnIds,
  defaultCliForKind,
  isSecretaryKind,
  managerColumnIds,
  seatKindFromId,
} from "@seat-mesh/core";
import { stampBaseColumn } from "./labels.js";
import { tmux } from "../lib/tmux-run.js";
import {
  coordPaneForRole,
  meshManagerPane,
  paneMetaForPane,
} from "../lib/pane-meta.js";
import { listWindowPaneIds } from "./window-panes.js";

export function baseColumns(loaded: LoadedProfile): BaseColumn[] {
  return baseColumnIds(loaded.profile.layout);
}

/** @deprecated primary manager column only — kept for call-site compat. */
export function managerStack(loaded: LoadedProfile): BaseColumn[] {
  const ids = managerColumnIds(loaded.profile.layout);
  return ids.length ? [ids[0]!] : ["manager"];
}

export function expectedBasePaneCount(loaded: LoadedProfile): number {
  return baseColumns(loaded).length;
}

export function cliForBaseColumn(loaded: LoadedProfile, col: BaseColumn): string {
  const override = loaded.profile.layout?.base.cli?.[col];
  if (override) return override;
  return defaultCliForKind(seatKindFromId(col, loaded.profile.layout?.base.kinds));
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

  realignBaseLayout(loaded, session);
  return panes;
}

/**
 * Pixel widths for base columns. Secretary gets `secPct` of usable width;
 * remaining columns split the rest equally (last column eats the remainder).
 */
export function columnWidthsPx(
  usable: number,
  cols: BaseColumn[],
  secPct: number,
  kinds?: Record<string, "manager" | "secretary" | "worker" | "mini">,
): number[] {
  const n = cols.length;
  if (n === 0 || usable < 1) return cols.map(() => 0);
  const secIdxs = cols
    .map((c, i) => (isSecretaryKind(c, kinds) ? i : -1))
    .filter((i) => i >= 0);
  const others = cols.map((_, i) => i).filter((i) => !secIdxs.includes(i));
  if (secIdxs.length === 0) {
    const each = Math.floor(usable / n);
    return cols.map((_, i) => (i === n - 1 ? usable - each * (n - 1) : each));
  }
  const secPool = Math.max(secIdxs.length, Math.round((usable * secPct) / 100));
  const widths = cols.map(() => 0);
  const secEach = Math.floor(secPool / secIdxs.length);
  secIdxs.forEach((i, k) => {
    widths[i] =
      k === secIdxs.length - 1 ? secPool - secEach * (secIdxs.length - 1) : secEach;
  });
  const remain = Math.max(0, usable - secPool);
  if (others.length === 0) {
    widths[secIdxs[0]!] = usable;
    return widths;
  }
  const each = Math.floor(remain / others.length);
  others.forEach((i, k) => {
    widths[i] = k === others.length - 1 ? remain - each * (others.length - 1) : each;
  });
  return widths;
}

/** Resize base columns to profile `secretaryWidthPct` (no kill/respawn). */
export function realignBaseLayout(loaded: LoadedProfile, session: string): boolean {
  const layout = loaded.profile.layout;
  if (!layout) return false;

  const baseWin = layout.base.window;
  const cols = baseColumns(loaded);
  const panes = cols.map((col) =>
    coordPaneForRole(session, baseWin, col) ??
    (col === cols[0] ? meshManagerPane(session, baseWin) : null),
  );
  if (panes.some((p) => !p)) return false;

  const usable = panes.reduce((sum, p) => sum + displayInt(p!, "#{pane_width}"), 0);
  if (usable < 20) return false;

  const wants = columnWidthsPx(
    usable,
    cols,
    secretaryWidthPct(loaded),
    loaded.profile.layout?.base.kinds,
  );
  let changed = false;
  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i]!;
    const want = wants[i]!;
    const cur = displayInt(pane, "#{pane_width}");
    if (want === cur) continue;
    tmux(["resize-pane", "-t", pane, "-x", String(want)]);
    changed = true;
  }
  return changed;
}

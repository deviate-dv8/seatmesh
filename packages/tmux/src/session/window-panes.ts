import {
  computeMinisWantOrder,
  normalizeMinisLeads,
  parseGridSpec,
  type MeshLayout,
} from "@seat-mesh/core";
import { withActivePanePreserved } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";

/**
 * Resolve mini-N pane by @mesh_mini label (survives 4x2 lead swaps).
 * No pane_index fallback — unlabeled grid cells stay plain for manual use.
 */
export function resolveMiniPaneId(
  session: string,
  window: string,
  n: number,
): string | null {
  const target = `${session}:${window}`;
  const out = tmux([
    "list-panes",
    "-t",
    target,
    "-F",
    "#{@mesh_mini}\t#{pane_id}",
  ]).out;
  if (!out) return null;
  const rows = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [mini, paneId] = line.split("\t");
      return { mini: mini ?? "", paneId: paneId ?? "" };
    })
    .filter((r) => r.paneId.startsWith("%"));

  const labeled = rows.find((r) => r.mini === String(n));
  return labeled?.paneId ?? null;
}

/** Pane ids in a single window, sorted by pane_index (stable slot order). */
export function listWindowPaneIds(session: string, window: string): string[] {
  const target = `${session}:${window}`;
  const out = tmux(["list-panes", "-t", target, "-F", "#{pane_index}\t#{pane_id}"]).out;
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [idx, paneId] = line.split("\t");
      return { idx: Number.parseInt(idx ?? "0", 10), paneId: paneId ?? "" };
    })
    .filter((r) => r.paneId.startsWith("%"))
    .sort((a, b) => a.idx - b.idx)
    .map((r) => r.paneId);
}

/** Collapse a window to a single pane (keeps lowest pane_index). */
export function ensureSinglePane(session: string, window: string): void {
  const panes = listWindowPaneIds(session, window);
  if (panes.length <= 1) return;
  const keep = panes[0];
  for (const paneId of panes.slice(1)) {
    const r = tmux(["kill-pane", "-t", paneId]);
    if (!r.ok) throw new Error(`kill-pane ${paneId}: ${r.err || r.out}`);
  }
  withActivePanePreserved(keep, () => {
    tmux(["select-pane", "-t", keep]);
  });
}

interface PaneArea {
  paneId: string;
  area: number;
}

function largestPane(session: string, window: string): string {
  const target = `${session}:${window}`;
  const out = tmux([
    "list-panes",
    "-t",
    target,
    "-F",
    "#{pane_id}\t#{pane_width}\t#{pane_height}",
  ]).out;
  const ranked: PaneArea[] = (out || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [paneId, w, h] = line.split("\t");
      return {
        paneId: paneId ?? "",
        area: Number.parseInt(w ?? "0", 10) * Number.parseInt(h ?? "0", 10),
      };
    })
    .filter((p) => p.paneId.startsWith("%"));
  ranked.sort((a, b) => b.area - a.area);
  const pick = ranked[0]?.paneId;
  if (!pick) throw new Error(`${target}: no panes to split`);
  return pick;
}

/**
 * Grow/shrink pane count without collapsing the whole window (preserves live CLIs).
 * Shrinks by killing highest pane_index panes only (call assertRelayoutSafe first).
 */
function ensurePaneCount(session: string, window: string, count: number, cwd: string): string[] {
  const target = `${session}:${window}`;
  let panes = listWindowPaneIds(session, window);

  if (panes.length === 0) {
    ensureSinglePane(session, window);
    panes = listWindowPaneIds(session, window);
  }

  while (panes.length > count) {
    const drop = panes[panes.length - 1];
    const r = tmux(["kill-pane", "-t", drop]);
    if (!r.ok) throw new Error(`kill-pane ${drop}: ${r.err || r.out}`);
    panes = listWindowPaneIds(session, window);
  }

  while (panes.length < count) {
    const anchor = largestPane(session, window);
    withActivePanePreserved(anchor, () => {
      tmux(["select-pane", "-t", anchor]);
      let r = tmux(["split-window", "-v", "-p", "50", "-t", target, "-c", cwd]);
      if (!r.ok) {
        r = tmux(["split-window", "-h", "-p", "50", "-t", target, "-c", cwd]);
      }
      if (!r.ok) throw new Error(`split-window ${target}: ${r.err || r.out}`);
    });
    panes = listWindowPaneIds(session, window);
  }

  return panes;
}

function tmuxLayoutChecksum(body: string): string {
  let csum = 0;
  for (const ch of body) {
    csum = ((csum >> 1) + ((csum & 1) << 15) + ch.charCodeAt(0)) & 0xffff;
  }
  return csum.toString(16).padStart(4, "0");
}

/** Equal cols×rows grid via tmux select-layout (row-major pane order = pane_index 0..N-1). */
function buildEqualGridLayout(
  width: number,
  height: number,
  paneNumericIds: number[],
  cols: number,
  rows: number,
  gap = 1,
): string {
  const total = cols * rows;
  if (paneNumericIds.length !== total) {
    throw new Error(`buildEqualGridLayout: want ${total} panes, have ${paneNumericIds.length}`);
  }

  const usableW = width - (cols - 1) * gap;
  const usableH = height - (rows - 1) * gap;
  const colWidths = Array.from({ length: cols }, () => Math.floor(usableW / cols));
  for (let i = 0; i < usableW % cols; i++) colWidths[i] += 1;
  const rowHeights = Array.from({ length: rows }, () => Math.floor(usableH / rows));
  for (let i = 0; i < usableH % rows; i++) rowHeights[i] += 1;

  const colXs: number[] = [];
  let x = 0;
  for (let i = 0; i < cols; i++) {
    colXs.push(x);
    x += colWidths[i] + (i < cols - 1 ? gap : 0);
  }

  const rowParts: string[] = [];
  let y = 0;
  for (let row = 0; row < rows; row++) {
    const h = rowHeights[row];
    const panes = paneNumericIds.slice(row * cols, row * cols + cols);
    const cells = panes.map((pid, col) => {
      const w = colWidths[col];
      const left = colXs[col];
      return `${w}x${h},${left},${y},${pid}`;
    });
    rowParts.push(`${width}x${h},0,${y}{${cells.join(",")}}`);
    y += h + (row < rows - 1 ? gap : 0);
  }

  const body = `${width}x${height},0,0[${rowParts.join(",")}]`;
  return `${tmuxLayoutChecksum(body)},${body}`;
}

/** Resize-only equal grid. Returns false if pane count does not already match. */
export function realignEqualGrid(
  session: string,
  window: string,
  cols: number,
  rows: number,
): boolean {
  const target = `${session}:${window}`;
  const total = cols * rows;
  const paneIds = listWindowPaneIds(session, window);
  if (paneIds.length !== total) return false;
  applyEqualGridToPanes(session, window, cols, rows, paneIds);
  return true;
}

function applyEqualGridToPanes(
  session: string,
  window: string,
  cols: number,
  rows: number,
  paneIds: string[],
): void {
  const target = `${session}:${window}`;
  const numeric = paneIds.map((id) => Number.parseInt(id.replace("%", ""), 10));

  const wr = tmux(["display-message", "-t", target, "-p", "#{window_width}"]);
  const hr = tmux(["display-message", "-t", target, "-p", "#{window_height}"]);
  const width = Number.parseInt(wr.out || "0", 10);
  const height = Number.parseInt(hr.out || "0", 10);
  if (!width || !height) {
    throw new Error(`${target}: could not read window size`);
  }

  const layout = buildEqualGridLayout(width, height, numeric, cols, rows);
  const lr = tmux(["select-layout", "-t", target, layout]);
  if (!lr.ok) {
    throw new Error(`select-layout ${cols}x${rows} ${target}: ${lr.err || lr.out}`);
  }

  const n = listWindowPaneIds(session, window).length;
  if (n !== cols * rows) {
    throw new Error(`${target}: ${cols}x${rows} want ${cols * rows} panes, have ${n}`);
  }
}

function applyEqualGridLayout(
  session: string,
  window: string,
  cols: number,
  rows: number,
  cwd: string,
): void {
  const paneIds = ensurePaneCount(session, window, cols * rows, cwd);
  applyEqualGridToPanes(session, window, cols, rows, paneIds);
}

/** 3x2 worker grid (equal cells, row-major pane_index = slots 1-6). */
export function layoutWorkers3x2(session: string, window: string, cwd: string): void {
  applyEqualGridLayout(session, window, 3, 2, cwd);
}

/** Equal worker grid from profile (`layout.workers.grid` + `slots`). */
export function layoutWorkersGrid(
  session: string,
  window: string,
  cwd: string,
  workers: MeshLayout["workers"],
): void {
  const { cols, rows } = parseGridSpec(workers.grid);
  if (workers.slots !== cols * rows) {
    throw new Error(
      `workers.slots ${workers.slots} must equal ${workers.grid} capacity ${cols * rows}`,
    );
  }
  applyEqualGridLayout(session, window, cols, rows, cwd);
}

/** Preferred worker layout entry point — replaces hard-coded layoutWorkers3x2. */
export function layoutWorkersFromProfile(
  session: string,
  window: string,
  cwd: string,
  workers: MeshLayout["workers"],
): void {
  layoutWorkersGrid(session, window, cwd, workers);
}

/** Equal minis grid from profile (`layout.minis.grid` + `max`). */
export function layoutMinisGrid(
  session: string,
  window: string,
  cwd: string,
  minis: MeshLayout["minis"],
): void {
  const { cols, rows } = parseGridSpec(minis.grid);
  if (minis.max !== cols * rows) {
    throw new Error(
      `minis.max ${minis.max} must equal ${minis.grid} capacity ${cols * rows}`,
    );
  }
  applyEqualGridLayout(session, window, cols, rows, cwd);
}

/** 4x2 minis grid (equal cells; prefer layoutMinisGrid from profile). */
export function layoutMinis4x2(session: string, window: string, cwd: string): void {
  applyEqualGridLayout(session, window, 4, 2, cwd);
}

interface MiniCell {
  mini: string;
  paneId: string;
  top: number;
  left: number;
}

/** Read each mini pane (@mesh_mini or pane_index+1) plus its visual cell (top,left). */
function readMiniCells(session: string, window: string): MiniCell[] {
  const target = `${session}:${window}`;
  const out = tmux([
    "list-panes",
    "-t",
    target,
    "-F",
    "#{pane_index}\t#{@mesh_mini}\t#{pane_top}\t#{pane_left}\t#{pane_id}",
  ]).out;
  return (out || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [idx, mini, top, left, paneId] = line.split("\t");
      const index = Number.parseInt(idx ?? "0", 10);
      const miniId = mini && mini !== "" ? mini : String(index + 1);
      return {
        mini: miniId,
        paneId: paneId ?? "",
        top: Number.parseInt(top ?? "0", 10),
        left: Number.parseInt(left ?? "0", 10),
      };
    })
    .filter((c) => c.paneId.startsWith("%"));
}

/** Cell contents in row-major visual order (row 0 top -> row 1 bottom, left->right). */
function miniCellOrder(cells: MiniCell[]): string[] {
  return [...cells].sort((a, b) => a.top - b.top || a.left - b.left).map((c) => c.mini);
}

/** Swap panes until visual row-major order matches `want` mini ids (@mesh_mini required). */
export function swapMinisToOrder(session: string, window: string, want: string[]): void {
  const target = `${session}:${window}`;
  const n = want.length;
  if (n === 0) return;

  for (let guard = 0; guard < n * 4; guard++) {
    const cells = readMiniCells(session, window);
    if (cells.length !== n) {
      throw new Error(`${target}: want order length ${n}, have ${cells.length} mini panes`);
    }
    const ordered = [...cells].sort((a, b) => a.top - b.top || a.left - b.left);
    const cur = ordered.map((c) => c.mini);
    let i = 0;
    while (i < n && cur[i] === want[i]) i++;
    if (i >= n) return;

    const wantMini = want[i];
    const cell = ordered[i];
    const curCell = cells.find((c) => c.top === cell.top && c.left === cell.left);
    const wantPane = cells.find((c) => c.mini === wantMini);
    if (!curCell || !wantPane) {
      throw new Error(`${target}: cannot resolve cell ${i} (mini ${wantMini})`);
    }
    if (curCell.paneId === wantPane.paneId) continue;
    const r = tmux(["swap-pane", "-d", "-s", wantPane.paneId, "-t", curCell.paneId]);
    if (!r.ok) {
      throw new Error(`swap-pane ${target}: ${r.err || r.out}`);
    }
  }
  throw new Error(`${target}: mini order swap did not converge`);
}

/** Apply profile leads placement after @mesh_mini labels exist. No-op when already correct. */
export function applyMinisLeadsFromProfile(
  session: string,
  window: string,
  minis: MeshLayout["minis"],
): void {
  const { cols, rows } = parseGridSpec(minis.grid);
  const leads = normalizeMinisLeads(minis.leads);
  const want = computeMinisWantOrder(cols, rows, minis.max, leads);
  const cells = readMiniCells(session, window);
  if (cells.length === 0) return;
  const cur = miniCellOrder(cells);
  if (cur.join(",") === want.join(",")) return;
  swapMinisToOrder(session, window, want);
}

/** @deprecated use applyMinisLeadsFromProfile — harness 4x2 dual-lead layout. */
export function swapMinisLeadsLeft(session: string, window: string): void {
  applyMinisLeadsFromProfile(session, window, {
    window,
    enabled: true,
    grid: "4x2",
    max: 8,
    leads: [1, 2],
  });
}

/** Profile grid + leads: call labelMeshSession before applyMinisLeadsFromProfile. */
export function layoutMinisFromProfile(
  session: string,
  window: string,
  cwd: string,
  minis: MeshLayout["minis"],
): void {
  layoutMinisGrid(session, window, cwd, minis);
}

/** Harness `run_mini_layout 4x2` parity: equal 4x2 grid then leads-left swap. */
export function layoutMinisLeadsLeft(session: string, window: string, cwd: string): void {
  layoutMinis4x2(session, window, cwd);
  swapMinisLeadsLeft(session, window);
}

/** @deprecated use layoutWorkers3x2 / layoutMinis4x2 */
export function layoutGrid(
  session: string,
  window: string,
  cols: number,
  rows: number,
  cwd: string,
): void {
  if (cols === 3 && rows === 2) {
    layoutWorkers3x2(session, window, cwd);
    return;
  }
  applyEqualGridLayout(session, window, cols, rows, cwd);
}

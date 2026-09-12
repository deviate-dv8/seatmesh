/** Shipped seatmesh banner mark (3-4: subtle round, 41×17, 4-layer ░▒▓█). */

const SHADES = [" ", "░", "▒", "▓", "█"] as const;

const W = 41;
const H = 17;
const THICKNESS = 4;
const R_APEX = 2.5;
const R_BASE = 0.25;
const BASE_BAND_ROWS = 3;

type Grid = string[][];

function useUnicodeBlocks(): boolean {
  return process.env.SEATMESH_ASCII_LOGO !== "1";
}

function emptyGrid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => " "));
}

function insideTriangle(x: number, y: number, w: number, h: number): boolean {
  const cx = (w - 1) / 2;
  const hw = h <= 1 ? 0 : ((w - 1) / 2) * (y / (h - 1));
  return y >= 0 && y < h && x >= cx - hw - 0.001 && x <= cx + hw + 0.001;
}

function edgeDistance(x: number, y: number, w: number, h: number): number {
  const cx = (w - 1) / 2;
  const hw = h <= 1 ? 0 : ((w - 1) / 2) * (y / (h - 1));
  const left = cx - hw;
  const right = cx + hw;
  return Math.min(x - left, right - x, h - 1 - y);
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function sharpTriangleSdf(x: number, y: number, w: number, h: number): number {
  const p0x = (w - 1) / 2;
  const p0y = 0;
  const p1x = 0;
  const p1y = h - 1;
  const p2x = w - 1;
  const p2y = h - 1;

  const e0x = p2x - p1x;
  const e0y = p2y - p1y;
  const e1x = p0x - p2x;
  const e1y = p0y - p2y;
  const e2x = p1x - p0x;
  const e2y = p1y - p0y;

  const v0x = x - p0x;
  const v0y = y - p0y;
  const v1x = x - p1x;
  const v1y = y - p1y;
  const v2x = x - p2x;
  const v2y = y - p2y;

  const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;
  const dot00 = dot(e0x, e0y, e0x, e0y);
  const dot11 = dot(e1x, e1y, e1x, e1y);
  const dot22 = dot(e2x, e2y, e2x, e2y);

  const pq0x = v1x - e0x * clamp01(dot(v1x, v1y, e0x, e0y) / (dot00 || 1));
  const pq0y = v1y - e0y * clamp01(dot(v1x, v1y, e0x, e0y) / (dot00 || 1));
  const pq1x = v2x - e1x * clamp01(dot(v2x, v2y, e1x, e1y) / (dot11 || 1));
  const pq1y = v2y - e1y * clamp01(dot(v2x, v2y, e1x, e1y) / (dot11 || 1));
  const pq2x = v0x - e2x * clamp01(dot(v0x, v0y, e2x, e2y) / (dot22 || 1));
  const pq2y = v0y - e2y * clamp01(dot(v0x, v0y, e2x, e2y) / (dot22 || 1));

  const s = Math.sign(e0x * e2y - e0y * e2x) || 1;
  const d0 = dot(pq0x, pq0y, pq0x, pq0y);
  const d1 = dot(pq1x, pq1y, pq1x, pq1y);
  const d2 = dot(pq2x, pq2y, pq2x, pq2y);
  const c0 = s * (v1x * e0y - v1y * e0x);
  const c1 = s * (v2x * e1y - v2y * e1x);
  const c2 = s * (v0x * e2y - v0y * e2x);

  let distSq = d0;
  let side = c0;
  if (d1 < distSq) {
    distSq = d1;
    side = c1;
  }
  if (d2 < distSq) {
    distSq = d2;
    side = c2;
  }
  return Math.sqrt(distSq) * (side < 0 ? -1 : 1);
}

function filletRadiusAt(y: number, h: number, rApex: number, rBase: number): number {
  const t = h <= 1 ? 0 : y / (h - 1);
  if (t >= 0.88) return rBase;
  const fade = Math.pow(1 - t / 0.88, 1.2);
  return rBase + (rApex - rBase) * fade;
}

function renderAsciiFallback(): string {
  const grid = emptyGrid(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!insideTriangle(x, y, W, H)) continue;
      if (edgeDistance(x, y, W, H) < THICKNESS) grid[y]![x] = "#";
    }
  }
  return grid.map((row) => row.join("")).join("\n");
}

function renderShippedMark(): string {
  if (!useUnicodeBlocks()) return renderAsciiFallback();

  const grid = emptyGrid(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let depth: number;
      if (y >= H - BASE_BAND_ROWS) {
        if (!insideTriangle(x, y, W, H)) continue;
        depth = edgeDistance(x, y, W, H);
      } else {
        const sdf = sharpTriangleSdf(px, py, W, H);
        const r = filletRadiusAt(py, H, R_APEX, R_BASE);
        if (sdf > -r) continue;
        depth = -r - sdf;
      }
      if (depth >= THICKNESS) continue;
      const layer = THICKNESS - 1 - Math.floor(depth);
      const idx = Math.min(SHADES.length - 1, 1 + layer);
      grid[y]![x] = SHADES[idx]!;
    }
  }
  return grid.map((row) => row.join("")).join("\n");
}

/** Banner triangle; hidden when SEATMESH_LOGO=none|off. */
export function renderLogoMark(): string {
  const key = process.env.SEATMESH_LOGO?.trim().toLowerCase();
  if (key === "none" || key === "off") return "";
  return renderShippedMark();
}

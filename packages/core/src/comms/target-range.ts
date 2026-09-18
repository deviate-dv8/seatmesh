/**
 * Ruby-style target ranges — the real agent shorthand for fanout.
 * Examples: `1..4` → slot-1..slot-4 · `slot-2..5` · `mini-1..3` · `m1..m2`
 * Also accepts comma lists: `1,3,5` · `slot-1,slot-3`
 */

export interface TargetRangeOpts {
  workerCount: number;
  miniMax: number;
}

const RANGE_RE =
  /^(?:(slot-?)?(\d+)\.\.(\d+)|(mini-|m)(\d+)\.\.(\d+)|(mini-|m)?(\d+)-(\d+))$/i;

function clampSlot(n: number, max: number, kind: "slot" | "mini"): void {
  if (n < 1 || n > max) {
    throw new Error(`refused: ${kind}-${n} outside 1..${max}`);
  }
}

function expandInclusive(a: number, b: number, max: number, kind: "slot" | "mini"): string[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  clampSlot(lo, max, kind);
  clampSlot(hi, max, kind);
  if (hi - lo > 31) {
    throw new Error(`refused: range ${lo}..${hi} too wide (max 32 targets)`);
  }
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) {
    out.push(kind === "slot" ? `slot-${i}` : `mini-${i}`);
  }
  return out;
}

/** True if token looks like a range or comma-list (not a single seat id). */
export function looksLikeTargetSpec(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t.includes(",") || t.includes("..")) return true;
  // bare 2-5 / slot-2-5 without dots — still a range
  if (/^(?:slot-?)?\d+-\d+$/i.test(t)) return true;
  if (/^(?:mini-|m)\d+-\d+$/i.test(t)) return true;
  return false;
}

/**
 * Expand one target token to canonical seat labels.
 * Single targets pass through unchanged (after normalizing bare `3` → `slot-3` only when expanding lists — singles stay as caller passed for resolve-pane).
 */
export function expandTargetSpec(raw: string, opts: TargetRangeOpts): string[] {
  const t = raw.trim();
  if (!t) throw new Error("empty target");

  if (t.includes(",")) {
    const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
    const out: string[] = [];
    for (const p of parts) {
      out.push(...expandTargetSpec(p, opts));
    }
    return [...new Set(out)];
  }

  const m = t.match(RANGE_RE);
  if (m) {
    // slot-?A..B  OR  A..B
    if (m[2] != null && m[3] != null) {
      return expandInclusive(Number(m[2]), Number(m[3]), opts.workerCount, "slot");
    }
    // mini-|m A..B
    if (m[5] != null && m[6] != null) {
      return expandInclusive(Number(m[5]), Number(m[6]), opts.miniMax, "mini");
    }
    // dash form: slot?A-B or mini A-B
    if (m[8] != null && m[9] != null) {
      const kind = m[7] && /^m/i.test(m[7]) ? "mini" : "slot";
      const max = kind === "mini" ? opts.miniMax : opts.workerCount;
      return expandInclusive(Number(m[8]), Number(m[9]), max, kind);
    }
  }

  // bare number in a multi context already handled; single pass-through
  if (/^[1-9]\d*$/.test(t)) {
    const n = Number(t);
    clampSlot(n, opts.workerCount, "slot");
    return [`slot-${n}`];
  }
  return [t];
}

export function targetRangeOptsFromProfile(profile: {
  session?: { workerCount?: number; miniMax?: number };
  layout?: { workers?: { slots?: number }; minis?: { max?: number } };
}): TargetRangeOpts {
  return {
    workerCount:
      profile.layout?.workers?.slots ?? profile.session?.workerCount ?? 6,
    miniMax: profile.layout?.minis?.max ?? profile.session?.miniMax ?? 8,
  };
}

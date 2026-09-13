import type { CheckbackRow } from "./jsonl-store.js";

/** Lower runs first when multiple checkbacks are due (supervise must not starve). */
export function checkbackFirePriority(kind: string | undefined): number {
  switch (kind) {
    case "secretary-supervise":
      return 0;
    case "balance-lead-tick":
      return 1;
    case "coord-expect":
      return 2;
    case "cc-limit-retry":
      return 2;
    case "coord-nudge":
      return 3;
    case "mesh-watch":
      return 2;
    default:
      if (kind?.endsWith("-nudge") && kind !== "manager-nudge") return 3;
      return 10;
  }
}

/** Indices of active due rows, sorted for fire order. */
export function sortDueCheckbackIndices(rows: CheckbackRow[], nowMs: number): number[] {
  const due: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.status !== "active") continue;
    const exp = row.expiresAt ? Date.parse(row.expiresAt) : 0;
    if (!exp || exp > nowMs) continue;
    due.push(i);
  }
  due.sort((a, b) => {
    const pa = checkbackFirePriority(rows[a].kind);
    const pb = checkbackFirePriority(rows[b].kind);
    if (pa !== pb) return pa - pb;
    const ea = Date.parse(rows[a].expiresAt ?? "") || 0;
    const eb = Date.parse(rows[b].expiresAt ?? "") || 0;
    return ea - eb;
  });
  return due;
}

/** Failed inject: push back so head-of-line cannot block supervise forever. */
export function deferCheckbackAfterFailedFire(row: CheckbackRow, nowMs: number): void {
  const renew = row.renewSec && row.renewSec > 0 ? row.renewSec : 180;
  const bumpSec = Math.min(Math.max(renew, 30), 90);
  row.expiresAt = new Date(nowMs + bumpSec * 1000).toISOString();
  row.updatedAt = new Date().toISOString();
}

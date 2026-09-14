import type { CheckbackRow } from "../store/jsonl-store.js";

/**
 * Peer/room poll-later: after this many successful fires, stop renewing.
 * Stops agents burning turns on cancel loops when a Check keeps coming back.
 * Supervise / mesh-watch / lead ticks stay unbounded.
 */
export const CHECKBACK_MAX_FIRES = 3;

/** Kinds that intentionally renew forever (campaigns / supervise loops). */
export function checkbackUnboundedRenew(kind: string | undefined): boolean {
  if (!kind) return false;
  if (
    kind === "mesh-watch" ||
    kind === "secretary-supervise" ||
    kind === "balance-lead-tick"
  ) {
    return true;
  }
  return kind.endsWith("-nudge");
}

/**
 * Whether a due row should re-arm after a successful fire.
 * Caps ordinary peer/room CBs by fireCount (fallback: age ≈ renewSec * max).
 */
export function shouldRenewCheckback(row: CheckbackRow, nowMs = Date.now()): boolean {
  if (!row.renewSec || row.renewSec <= 0) return false;
  if (checkbackUnboundedRenew(row.kind)) return true;
  const fires = row.fireCount ?? 0;
  if (fires >= CHECKBACK_MAX_FIRES) return false;
  const created = Date.parse(row.createdAt || "") || nowMs;
  const maxLifeMs = row.renewSec * 1000 * CHECKBACK_MAX_FIRES;
  if (nowMs - created >= maxLifeMs) return false;
  return true;
}

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

/**
 * Operator / manager / secretary override: show idle instead of sticky CC-LIMIT
 * (and other limit borders) without cancelling armed cc-limit-retry checkbacks.
 */
const overrideByPane = new Map<string, number>();
let overrideAllUntil = 0;

/** Suppress limit sticky borders (visual only). `*` = all panes. */
export function setLimitIdleOverride(
  paneId: string | "*",
  ttlMs = 24 * 60 * 60_000,
  nowMs = Date.now(),
): void {
  const until = nowMs + Math.max(60_000, ttlMs);
  if (paneId === "*" || paneId === "all") {
    overrideAllUntil = until;
    return;
  }
  overrideByPane.set(paneId, until);
}

export function clearLimitIdleOverride(paneId?: string): void {
  if (!paneId || paneId === "*" || paneId === "all") {
    overrideByPane.clear();
    overrideAllUntil = 0;
    return;
  }
  overrideByPane.delete(paneId);
}

export function hasLimitIdleOverride(paneId: string, nowMs = Date.now()): boolean {
  if (overrideAllUntil > nowMs) return true;
  if (overrideAllUntil && overrideAllUntil <= nowMs) overrideAllUntil = 0;
  const until = overrideByPane.get(paneId) ?? 0;
  if (until > nowMs) return true;
  if (until) overrideByPane.delete(paneId);
  return false;
}

/** True when candidate is a limit/proxy sticky we may force-idle. */
export function isLimitBorderStatus(status: string): boolean {
  return /^(CC-LIMIT|CURSOR-LIMIT|KIRO-LIMIT|PROXY-DOWN|OC-LIMIT:|LIMIT\b)/i.test(
    status.trim(),
  );
}

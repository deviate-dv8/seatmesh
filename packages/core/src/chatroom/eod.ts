/** Parse operator deadlines: eod | ISO | duration (5m, 6h). */

import { expiresAtUtcFromDuration, parseDurationToSeconds } from "./duration.js";

/** End of local calendar day (23:59:59.999) on the host clock. */
export function deadlineAtEod(now = new Date()): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Parse `--deadline`:
 * - omit / `eod` / `EOD` → end of day (local)
 * - ISO timestamp
 * - duration (`6h`, `30m`) from now
 */
export function parseTargetDeadline(
  raw: string | undefined,
  now = new Date(),
): { ok: true; deadlineAt: string } | { ok: false; error: string } {
  const t = (raw ?? "eod").trim();
  if (!t || /^eod$/i.test(t) || /^end[- ]?of[- ]?day$/i.test(t)) {
    return { ok: true, deadlineAt: deadlineAtEod(now).toISOString() };
  }
  if (parseDurationToSeconds(t) != null) {
    const iso = expiresAtUtcFromDuration(t);
    if (!iso) return { ok: false, error: `bad duration: ${t}` };
    return { ok: true, deadlineAt: iso };
  }
  const ms = Date.parse(t);
  if (!Number.isNaN(ms)) {
    return { ok: true, deadlineAt: new Date(ms).toISOString() };
  }
  return { ok: false, error: `bad deadline: ${t} (want eod | ISO | 6h)` };
}

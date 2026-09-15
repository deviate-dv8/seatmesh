import { createHash } from "node:crypto";
import type { PaneSnapshot, ProviderRegistry } from "@seat-mesh/core";
import { meshInboxContinueLead } from "@seat-mesh/core";
import type { CheckbackRow, QueueStore } from "../store/create-queue-store.js";
import { capturePaneSnapshot, listMeshMonitorPanes } from "@seat-mesh/tmux";

const CC_LIMIT_RETRY_ID_PREFIX = "cb-cc-limit-retry-";

/** Fire one minute after the printed reset time (e.g. 6:40PM → 6:41PM). */
export const CC_LIMIT_RETRY_BUFFER_MS = 60_000;

/** Stable id for same pane + Claude resume session (cancel when pane replaced). */
export function paneSessionFingerprint(
  registry: ProviderRegistry,
  snap: PaneSnapshot,
): string {
  const prov = registry.detect(snap);
  const det = prov?.detect(snap);
  const resume = det?.resumeId ?? "";
  const cmd = snap.currentCommand ?? "";
  const h = createHash("sha256")
    .update(`${prov?.id ?? "?"}|${resume}|${cmd}`)
    .digest("hex");
  return h.slice(0, 16);
}

/**
 * Parse Claude limit reset time from capture.
 * Accepts: "try again at 6:40 PM", "resets at 6:40PM", "reset at 18:40", …
 * Returns epoch ms for that clock today (or tomorrow if already past), without buffer.
 */
export function parseCcLimitRetryAtMs(captureTail: string, now = Date.now()): number | null {
  const m = captureTail.match(
    /(?:try again|resets?|available(?:\s+again)?|limit\s+resets?)\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (!m) {
    // Fallback: bare "6:40 PM" near limit wording
    if (!/rate\s*limit|usage\s*limit|limit\s+reached|quota/i.test(captureTail)) return null;
    const bare = captureTail.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
    if (!bare) return null;
    return clockToMs(Number(bare[1]), Number(bare[2]), (bare[3] ?? "").toUpperCase(), now);
  }
  return clockToMs(Number(m[1]), Number(m[2]), (m[3] ?? "").toUpperCase(), now);
}

function clockToMs(hourIn: number, min: number, ampm: string, now: number): number {
  let hour = hourIn;
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(hour, min, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Reset clock + 1 minute buffer (6:40 → fire 6:41). */
export function ccLimitRetryFireAtMs(captureTail: string, now = Date.now()): number {
  const parsed = parseCcLimitRetryAtMs(captureTail, now);
  if (parsed != null) return parsed + CC_LIMIT_RETRY_BUFFER_MS;
  return now + 30 * 60_000;
}

export function armCcLimitRetryCheckback(
  store: QueueStore,
  paneId: string,
  fingerprint: string,
  expiresAtMs: number,
  log: (line: string) => void,
): void {
  const id = `${CC_LIMIT_RETRY_ID_PREFIX}${paneId.replace(/%/g, "")}`;
  const rows = store.readCheckbacks();
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(expiresAtMs).toISOString();
  const existing = rows.find((r) => r.id === id && r.status === "active");
  if (existing?.expect?.includes(fingerprint) && existing.expiresAt === expiresAt) {
    return;
  }
  const row: CheckbackRow = {
    id,
    kind: "cc-limit-retry",
    status: "active",
    expect: `F-cc-limit-retry ${fingerprint}`,
    ownerPane: paneId,
    expiresAt,
    // One-shot: fire once at expiresAt — do not renew forever.
    renewSec: 0,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    senderLabel: "inbox",
    recipientLabel: paneId,
    sessionFingerprint: fingerprint,
  };
  store.upsertCheckback(row);
  log(`cc-limit-retry armed pane=${paneId} at=${expiresAt} fp=${fingerprint}`);
}

export function ccLimitRetryFingerprintFromExpect(expect: string): string | null {
  const m = expect.match(/^F-cc-limit-retry ([a-f0-9]+)/);
  return m?.[1] ?? null;
}

/** True only when the live pane is still Claude with the same session fingerprint. */
export function paneMatchesCcLimitFingerprint(
  registry: ProviderRegistry,
  paneId: string,
  fingerprint: string,
): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov || prov.id !== "claude") return false;
  return paneSessionFingerprint(registry, snap) === fingerprint;
}

export function meshInboxCcLimitRetryContinue(role: string): string {
  return meshInboxContinueLead(role);
}

export interface ClaudePaneHit {
  paneId: string;
  fingerprint: string;
  label: string;
}

/** All live Claude panes in the mesh monitor set (for CC-limit fanout). */
export function listClaudePanesForCcLimit(
  registry: ProviderRegistry,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
): ClaudePaneHit[] {
  const out: ClaudePaneHit[] = [];
  for (const p of listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow)) {
    const snap = capturePaneSnapshot(p.paneId);
    if (!snap) continue;
    const prov = registry.detect(snap);
    if (!prov || prov.id !== "claude") continue;
    out.push({
      paneId: p.paneId,
      fingerprint: paneSessionFingerprint(registry, snap),
      label: p.label || p.paneId,
    });
  }
  return out;
}

/**
 * When any Claude pane hits CC-LIMIT, arm a one-shot CB for every current Claude
 * pane at the same fire time. Each row carries that pane's session fingerprint —
 * if the seat is later switched to OC/kiro/cursor, fire cancels for that pane only.
 */
export function armCcLimitRetryForAllClaudePanes(
  store: QueueStore,
  registry: ProviderRegistry,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  fireAtMs: number,
  log: (line: string) => void,
  sourcePaneId?: string,
): number {
  const panes = listClaudePanesForCcLimit(
    registry,
    session,
    baseWindow,
    workersWindow,
    minisWindow,
  );
  if (!panes.length) {
    log("cc-limit-retry fanout: no claude panes");
    return 0;
  }
  log(
    `cc-limit-retry fanout n=${panes.length} at=${new Date(fireAtMs).toISOString()}` +
      (sourcePaneId ? ` source=${sourcePaneId}` : ""),
  );
  for (const p of panes) {
    armCcLimitRetryCheckback(store, p.paneId, p.fingerprint, fireAtMs, log);
  }
  return panes.length;
}

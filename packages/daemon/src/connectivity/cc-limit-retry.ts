import { createHash } from "node:crypto";
import type { PaneSnapshot, ProviderRegistry } from "@seat-mesh/core";
import { meshInboxContinueLead } from "@seat-mesh/core";
import type { CheckbackRow, QueueStore } from "../store/create-queue-store.js";
import { capturePaneSnapshot } from "@seat-mesh/tmux";

const CC_LIMIT_RETRY_ID_PREFIX = "cb-cc-limit-retry-";

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

/** Parse "try again at 8:00 PM" style from Claude limit screen (Asia/Manila default). */
export function parseCcLimitRetryAtMs(captureTail: string, now = Date.now()): number | null {
  const m = captureTail.match(/try again (?:at )?(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  const ampm = (m[3] ?? "").toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const d = new Date(now);
  d.setHours(hour, min, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
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
  if (existing?.expect?.includes(fingerprint)) {
    return;
  }
  const row: CheckbackRow = {
    id,
    kind: "cc-limit-retry",
    status: "active",
    expect: `F-cc-limit-retry ${fingerprint}`,
    ownerPane: paneId,
    expiresAt,
    renewSec: 300,
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

export function paneMatchesCcLimitFingerprint(
  registry: ProviderRegistry,
  paneId: string,
  fingerprint: string,
): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  return paneSessionFingerprint(registry, snap) === fingerprint;
}

export function meshInboxCcLimitRetryContinue(role: string): string {
  return meshInboxContinueLead(role);
}

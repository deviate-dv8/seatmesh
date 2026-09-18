/**
 * Merge active CHECKBACK.jsonl rows into the live store.
 * Fixes supervise/balance local jsonl arms that never reached sqlite after migrate.
 */
import fs from "node:fs";
import path from "node:path";
import type { CheckbackRow } from "./jsonl-store.js";
import type { QueueStore } from "./create-queue-store.js";

function readJsonlCheckbacks(file: string): CheckbackRow[] {
  if (!fs.existsSync(file)) return [];
  const out: CheckbackRow[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as CheckbackRow);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Import active jsonl CBs missing (or cancelled) in the store. Returns import count. */
export function reconcileCheckbacksFromJsonl(
  store: QueueStore,
  daemonDir: string,
  log: (line: string) => void = () => {},
): number {
  const file = path.join(daemonDir, "CHECKBACK.jsonl");
  const jsonlRows = readJsonlCheckbacks(file).filter((r) => r.status === "active");
  if (!jsonlRows.length) return 0;

  const existing = new Map(store.readCheckbacks().map((r) => [r.id, r]));
  let imported = 0;
  for (const row of jsonlRows) {
    const cur = existing.get(row.id);
    if (cur && cur.status === "active") continue;
    store.upsertCheckback({
      ...row,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    imported += 1;
  }
  if (imported) {
    log(`CHECKBACK reconcile: imported ${imported} active row(s) from jsonl → store`);
  }
  return imported;
}

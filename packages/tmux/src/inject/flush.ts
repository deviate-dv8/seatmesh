import type { LoadedProfile, ProviderRegistry } from "seat-mesh-core";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { flushToPane } from "./inject.js";

export interface FlushResult {
  target: string;
  paneId: string;
  status: "flushed" | "skipped";
  reason?: string;
}

export function runFlush(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
): FlushResult[] {
  const session = loaded.sessionName;
  const results: FlushResult[] = [];

  const targets: string[] =
    target === "all"
      ? Array.from({ length: loaded.profile.session.workerCount }, (_, i) => String(i + 1))
      : [target];

  for (const t of targets) {
    const resolved = resolvePaneTarget(t, loaded);
    if ("error" in resolved) {
      results.push({ target: t, paneId: "-", status: "skipped", reason: resolved.error });
      continue;
    }
    const snap = capturePaneSnapshot(resolved.paneId);
    if (!snap) {
      results.push({
        target: t,
        paneId: resolved.paneId,
        status: "skipped",
        reason: "capture failed",
      });
      continue;
    }
    const prov = registry.detect(snap);
    if (!prov) {
      results.push({
        target: t,
        paneId: resolved.paneId,
        status: "skipped",
        reason: "plain terminal",
      });
      continue;
    }
    const state = prov.composerState(snap);
    if (state.phase === "plain_shell") {
      results.push({
        target: t,
        paneId: resolved.paneId,
        status: "skipped",
        reason: "plain_shell",
      });
      continue;
    }
    flushToPane(resolved.paneId, prov.id);
    results.push({ target: t, paneId: resolved.paneId, status: "flushed" });
  }

  return results;
}

export function printFlushResults(results: FlushResult[]): void {
  let sent = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "flushed") {
      sent++;
      console.log(`flushed -> ${r.target} ${r.paneId}`);
    } else {
      skipped++;
      console.log(`skip ${r.target}: ${r.reason ?? "skipped"}`);
    }
  }
  console.log(`flush done: sent=${sent} skipped=${skipped}`);
}

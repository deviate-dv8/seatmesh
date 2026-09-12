import type { LoadedProfile } from "@seat-mesh/core";
import { meshRuntimePaths } from "@seat-mesh/core";
import { JsonlStore } from "./jsonl-store.js";
import { migrateJsonlDirToSqlite, SqliteStore } from "./sqlite-store.js";

export type { CheckbackRow, PeerRow, ToMasterRow, PeerKind } from "./jsonl-store.js";
export { isInboxDelivered, isPeerDelivered, dedupeJsonlRowsById } from "./jsonl-store.js";

export type QueueStore = JsonlStore | SqliteStore;

export function createQueueStore(loaded: LoadedProfile, log: (line: string) => void): QueueStore {
  const rt = meshRuntimePaths(loaded);
  if (rt.storageBackend === "jsonl") {
    return new JsonlStore(rt.daemonDir, log);
  }
  try {
    migrateJsonlDirToSqlite(rt.sqlitePath, rt.daemonDir, log);
    return new SqliteStore(rt.sqlitePath, rt.daemonDir, log);
  } catch (e) {
    log(
      `WARN: sqlite unavailable (${(e as Error).message}) — falling back to jsonl in ${rt.daemonDir}`,
    );
    return new JsonlStore(rt.daemonDir, log);
  }
}

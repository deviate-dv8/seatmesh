import type { LoadedProfile } from "@seat-mesh/core";
import type { PeerRow } from "../store/create-queue-store.js";
import { isTriageContextRow } from "../peer/peer-triage.js";

export interface InjectDebounceOpts {
  /** Trailing quiet window (ms). 0 = off (legacy per-tick inject). */
  ms: number;
  /** Max wait from oldest pending row before inject even if mail keeps arriving. */
  maxMs: number;
}

export function injectDebounceOpts(loaded: LoadedProfile): InjectDebounceOpts {
  const env = process.env.MESH_INJECT_DEBOUNCE_MS;
  const fromEnv = env != null && env.trim() !== "" ? Number(env) : undefined;
  const ms = fromEnv ?? loaded.profile.daemon?.injectDebounceMs ?? 2500;
  const maxMs = loaded.profile.daemon?.injectDebounceMaxMs ?? 8000;
  return {
    ms: Math.max(0, Math.floor(ms)),
    maxMs: Math.max(Math.max(0, Math.floor(ms)), Math.floor(maxMs)),
  };
}

/** Rows with `at` ISO timestamps — peer + inbox queues. */
export function injectDebounceReady(
  pendingRows: { at: string }[],
  opts: InjectDebounceOpts,
  nowMs = Date.now(),
): boolean {
  if (opts.ms <= 0 || !pendingRows.length) return true;
  const times = pendingRows
    .map((r) => Date.parse(r.at))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return true;
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (nowMs - first >= opts.maxMs) return true;
  return nowMs - last >= opts.ms;
}

/** Direct steering / cold-start — skip debounce (solo inject). */
export function peerBypassesInjectDebounce(row: PeerRow): boolean {
  if (row.fromSlot === "mesh-cold-start") return true;
  if (isTriageContextRow(row)) return true;
  if (row.kind === "prompt" || row.kind === "remind") return true;
  if (/\bPRIORITY\b|\bSTOP other work\b/i.test(row.msg)) return true;
  return false;
}

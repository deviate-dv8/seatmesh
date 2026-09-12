import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { meshRuntimePaths, type LoadedProfile } from "seat-mesh-core";

interface ColdStartPaneRow {
  fingerprint: string;
  at: string;
  label: string;
  delivered?: boolean;
}

interface ColdStartStateFile {
  panes: Record<string, ColdStartPaneRow>;
}

function statePath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).coldStartState;
}

function readState(loaded: LoadedProfile): ColdStartStateFile {
  const p = statePath(loaded);
  if (!fs.existsSync(p)) return { panes: {} };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ColdStartStateFile;
  } catch {
    return { panes: {} };
  }
}

function writeState(loaded: LoadedProfile, state: ColdStartStateFile): void {
  const p = statePath(loaded);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

/** Fingerprint from hub files — changes when queue/focus/tasks change. */
export function seatHubFingerprint(loaded: LoadedProfile, filePaths: (string | null)[]): string {
  const parts: string[] = [];
  for (const f of filePaths) {
    if (!f || !fs.existsSync(f)) {
      parts.push("missing");
      continue;
    }
    const st = fs.statSync(f);
    parts.push(`${f}:${st.mtimeMs}:${st.size}`);
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function hasPendingColdStartPeer(loaded: LoadedProfile, targetPane: string): boolean {
  const peer = meshRuntimePaths(loaded).peerJsonl;
  if (!fs.existsSync(peer)) return false;
  for (const line of fs.readFileSync(peer, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as {
        sent?: boolean;
        targetPane?: string;
        fromSlot?: string;
      };
      if (
        row.targetPane === targetPane &&
        row.fromSlot === "mesh-cold-start" &&
        row.sent !== true
      ) {
        return true;
      }
    } catch {
      /* skip bad line */
    }
  }
  return false;
}

/** Idempotent: skip when hub unchanged and already queued or delivered this fingerprint. */
export function shouldSkipColdStartEnqueue(
  loaded: LoadedProfile,
  targetPane: string,
  label: string,
  fingerprint: string,
  opts: { force?: boolean } = {},
): boolean {
  if (opts.force) return false;
  if (hasPendingColdStartPeer(loaded, targetPane)) return true;

  const state = readState(loaded);
  const prev = state.panes[targetPane];
  if (prev && prev.fingerprint === fingerprint) return true;

  return false;
}

export function recordColdStartEnqueue(
  loaded: LoadedProfile,
  targetPane: string,
  label: string,
  fingerprint: string,
): void {
  const state = readState(loaded);
  state.panes[targetPane] = {
    fingerprint,
    at: new Date().toISOString(),
    label,
    delivered: false,
  };
  writeState(loaded, state);
}

/** After CLI replace / relaunch — block inbox+peer until cold-start delivers. */
export function invalidatePaneContext(
  loaded: LoadedProfile,
  targetPane: string,
  label: string,
): void {
  const state = readState(loaded);
  const prev = state.panes[targetPane];
  state.panes[targetPane] = {
    fingerprint: prev?.fingerprint ?? "",
    at: new Date().toISOString(),
    label,
    delivered: false,
  };
  writeState(loaded, state);
}

export function markColdStartDelivered(loaded: LoadedProfile, targetPane: string): void {
  const state = readState(loaded);
  const prev = state.panes[targetPane];
  if (!prev) return;
  prev.delivered = true;
  writeState(loaded, state);
}

/** False while cold-start pending or undelivered for this pane. */
export function isPaneContextReady(loaded: LoadedProfile, targetPane: string): boolean {
  if (hasPendingColdStartPeer(loaded, targetPane)) return false;
  const state = readState(loaded);
  const prev = state.panes[targetPane];
  if (prev && prev.delivered === false) return false;
  return true;
}

/** True when this pane never got a delivered role briefing (common on first boot / pre-fix manager-b). */
export function lacksDeliveredColdStart(loaded: LoadedProfile, targetPane: string): boolean {
  const prev = readState(loaded).panes[targetPane];
  return !prev || prev.delivered !== true;
}

export function clearColdStartStateForTests(loaded: LoadedProfile): void {
  const p = statePath(loaded);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

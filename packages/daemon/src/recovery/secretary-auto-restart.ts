import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  meshSecretaryPane,
  unstickOpenCodeAndPrompt,
} from "@seat-mesh/tmux";

const STUCK_BUSY_MS = 90_000;
const AUTO_COOLDOWN_MS = 60_000;

const stuckBusySince = new Map<string, number>();
const stuckProgressPct = new Map<string, { pct: string; since: number }>();
let lastAutoUnstickAt = 0;
let autoUnstickInFlight = false;

function tmuxOpt(paneId: string, key: string): string {
  return (
    spawnSync("tmux", ["display-message", "-t", paneId, "-p", `#{@${key}}`], {
      encoding: "utf8",
    }).stdout?.trim() ?? ""
  );
}

export function secretaryPaneStatus(paneId: string | null): string | null {
  if (!paneId) return null;
  const s = tmuxOpt(paneId, "mesh_status");
  return s || null;
}

function captureProgressPct(tail: string): string | null {
  const m = tail.match(/\((\d+)%\)\s*ctrl\+p commands/i);
  return m?.[1] ?? null;
}

function isStuckOpenCodeGeneration(
  paneId: string,
  registry: ProviderRegistry,
): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const tail = snap.captureTail ?? "";
  const prov = registry.detect(snap);
  const st = prov?.composerState(snap);
  const generating = /esc interrupt/i.test(tail) && st?.phase === "busy";
  if (!generating) {
    stuckBusySince.delete(paneId);
    stuckProgressPct.delete(paneId);
    return false;
  }
  const now = Date.now();
  const pct = captureProgressPct(tail);
  if (pct) {
    const prev = stuckProgressPct.get(paneId);
    if (!prev || prev.pct !== pct) {
      stuckProgressPct.set(paneId, { pct, since: now });
    } else if (now - prev.since >= STUCK_BUSY_MS) {
      return true;
    }
  }
  const since = stuckBusySince.get(paneId) ?? now;
  if (!stuckBusySince.has(paneId)) stuckBusySince.set(paneId, now);
  return now - since >= STUCK_BUSY_MS * 2;
}

export interface SecretaryAutoRestartCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  session: string;
  baseWindow: string;
  log: (line: string) => void;
}

/** Esc×3 cancel stuck gen → cold-start prompt (no CPE relaunch). */
export function pollSecretaryAutoRestart(ctx: SecretaryAutoRestartCtx): boolean {
  const paneId = meshSecretaryPane(ctx.session, ctx.baseWindow);
  if (!paneId) return false;

  const status = secretaryPaneStatus(paneId);
  if (status === "restarting" || autoUnstickInFlight) return false;
  if (Date.now() - lastAutoUnstickAt < AUTO_COOLDOWN_MS) return false;
  if (!isStuckOpenCodeGeneration(paneId, ctx.registry)) return false;

  ctx.log(`SECRETARY-UNSTICK esc×3 + prompt pane=${paneId}`);
  autoUnstickInFlight = true;
  lastAutoUnstickAt = Date.now();
  stuckBusySince.delete(paneId);
  stuckProgressPct.delete(paneId);
  try {
    unstickOpenCodeAndPrompt(ctx.loaded, ctx.registry, "secretary", paneId);
    ctx.log(`SECRETARY-UNSTICK done pane=${paneId}`);
    return true;
  } catch (e) {
    ctx.log(`SECRETARY-UNSTICK fail: ${(e as Error).message}`);
    return false;
  } finally {
    autoUnstickInFlight = false;
  }
}

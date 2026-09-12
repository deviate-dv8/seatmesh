import { spawnSync } from "node:child_process";
import type { PaneSnapshot, ProviderRegistry } from "seat-mesh-core";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

export interface WaitCliOptions {
  maxTries?: number;
  pollMs?: number;
  /** Also wait until provider.composerReady (not just detect). */
  requireComposerReady?: boolean;
}

/** Poll until a live CLI is detected in the pane. */
export function waitForCli(
  registry: ProviderRegistry,
  paneId: string,
  capture: (paneId: string) => PaneSnapshot | null,
  opts: WaitCliOptions = {},
): { providerId: string } | null {
  const maxTries = opts.maxTries ?? 25;
  const pollMs = opts.pollMs ?? 400;
  for (let i = 0; i < maxTries; i++) {
    const snap = capture(paneId);
    const prov = snap ? registry.detect(snap) : null;
    if (prov && snap) {
      if (!opts.requireComposerReady || prov.composerReady(snap)) {
        return { providerId: prov.id };
      }
    }
    sleepMs(pollMs);
  }
  return null;
}

/** Poll until provider reports composer ready (post-launch inject gate). */
export function waitForComposerReady(
  registry: ProviderRegistry,
  paneId: string,
  capture: (paneId: string) => PaneSnapshot | null,
  providerId?: string,
  opts: { maxTries?: number; pollMs?: number } = {},
): boolean {
  const maxTries = opts.maxTries ?? 45;
  const pollMs = opts.pollMs ?? 400;
  for (let i = 0; i < maxTries; i++) {
    const snap = capture(paneId);
    if (!snap) {
      sleepMs(pollMs);
      continue;
    }
    const prov = providerId ? registry.get(providerId) : registry.detect(snap);
    if (prov?.composerReady(snap)) return true;
    sleepMs(pollMs);
  }
  return false;
}

import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { createRegistryForProfile, waitForCli } from "@seat-mesh/providers";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { syncOpenCodePaneSession } from "./oc-session-sync.js";

export function normalizeHarnessType(type: string): string {
  return type === "cursor-agent" ? "agent" : type;
}

export function isOpenCodeLaunch(type: string, cmd: string | null | undefined): boolean {
  const t = normalizeHarnessType(type);
  return t === "opencode" || Boolean(cmd?.includes("opencode-cpe.sh"));
}

const OC_WAIT_FIRST = { maxTries: 50, pollMs: 500, requireComposerReady: true as const };
const OC_WAIT_RETRY = { maxTries: 70, pollMs: 500, requireComposerReady: true as const };

/**
 * Wait until OpenCode is detected and composer-ready, then stamp @mesh_oc_session.
 * Call only after pasteLaunchCmd — not before cpe-proxy-up / opencode boot finish.
 */
export function waitForOpenCodeLaunch(
  registry: ProviderRegistry,
  paneId: string,
  retry = false,
): { ok: true; providerId: string } | { ok: false; reason: string } {
  const live = waitForCli(
    registry,
    paneId,
    capturePaneSnapshot,
    retry ? OC_WAIT_RETRY : OC_WAIT_FIRST,
  );
  if (!live) {
    return { ok: false, reason: "opencode not live (plain_shell or composer not ready)" };
  }
  syncOpenCodePaneSession(paneId, { waitMs: 1500, retries: 3 });
  return { ok: true, providerId: live.providerId };
}

/** Paste launch cmd + verify OpenCode with one retry (secretary/minis/launch parity). */
export function verifyOpenCodeAfterPaste(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  paneId: string,
  pasteAgain: () => void,
): { ok: true; providerId: string } | { ok: false; reason: string } {
  let result = waitForOpenCodeLaunch(registry, paneId, false);
  if (result.ok) return result;
  pasteAgain();
  result = waitForOpenCodeLaunch(registry, paneId, true);
  return result;
}

export function registryForProfile(loaded: LoadedProfile): ProviderRegistry {
  return createRegistryForProfile(loaded.profile);
}

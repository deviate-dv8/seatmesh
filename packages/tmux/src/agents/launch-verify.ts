import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { createRegistryForProfile, waitForCli } from "@seat-mesh/providers";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmux } from "../lib/tmux-run.js";
import { syncOpenCodePaneSession } from "./oc-session-sync.js";
import { spawnSync } from "node:child_process";

export function normalizeHarnessType(type: string): string {
  return type === "cursor-agent" ? "agent" : type;
}

export function isOpenCodeLaunch(type: string, cmd: string | null | undefined): boolean {
  const t = normalizeHarnessType(type);
  return t === "opencode" || Boolean(cmd?.includes("opencode-cpe.sh"));
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

const OC_WAIT_FIRST = { maxTries: 50, pollMs: 500, requireComposerReady: true as const };
const OC_WAIT_RETRY = { maxTries: 70, pollMs: 500, requireComposerReady: true as const };
const AGENT_WAIT = { maxTries: 40, pollMs: 400, requireComposerReady: true as const };
const AGENT_WAIT_RETRY = { maxTries: 55, pollMs: 400, requireComposerReady: true as const };
const CLAUDE_WAIT = { maxTries: 50, pollMs: 400, requireComposerReady: true as const };
const CLAUDE_WAIT_RETRY = { maxTries: 70, pollMs: 400, requireComposerReady: true as const };

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
  syncOpenCodePaneSession(paneId, { waitMs: 1500, retries: 14 });
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

function looksLikeCursorTrustDialog(text: string): boolean {
  return /trust (this |the )?workspace|do you trust the authors|workspace trust|accept this workspace/i.test(
    text,
  );
}

/**
 * Belt-and-suspenders if `--trust` was ignored by an older agent build.
 * Prefer Enter (Trust/Accept often focused); fall back to y.
 */
export function acceptCursorTrustDialog(paneId: string): boolean {
  for (let i = 0; i < 20; i++) {
    const text = capturePaneSnapshot(paneId)?.captureTail ?? "";
    if (looksLikeCursorTrustDialog(text)) {
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(400);
      const after = capturePaneSnapshot(paneId)?.captureTail ?? "";
      if (!looksLikeCursorTrustDialog(after)) return true;
      tmux(["send-keys", "-t", paneId, "y"]);
      sleepMs(200);
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(400);
      return true;
    }
    // Already past trust into composer chrome
    if (/Add a follow-up|Plan, search|ctrl\+c to stop/i.test(text)) return true;
    const snap = capturePaneSnapshot(paneId);
    if (snap && /agent(\s|$)/i.test(snap.currentCommand ?? "") && !looksLikeCursorTrustDialog(text)) {
      // process up, no dialog — ok
      if (i > 4) return true;
    }
    sleepMs(300);
  }
  return false;
}

export function waitForCursorAgentLaunch(
  registry: ProviderRegistry,
  paneId: string,
  retry = false,
): { ok: true; providerId: string } | { ok: false; reason: string } {
  acceptCursorTrustDialog(paneId);
  const live = waitForCli(
    registry,
    paneId,
    capturePaneSnapshot,
    retry ? AGENT_WAIT_RETRY : AGENT_WAIT,
  );
  if (!live || live.providerId !== "cursor-agent") {
    return { ok: false, reason: "cursor-agent not live (trust dialog or composer not ready)" };
  }
  const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
  if (looksLikeCursorTrustDialog(tail)) {
    return { ok: false, reason: "cursor-agent stuck on workspace trust dialog" };
  }
  return { ok: true, providerId: live.providerId };
}

export function verifyCursorAgentAfterPaste(
  _loaded: LoadedProfile,
  registry: ProviderRegistry,
  paneId: string,
  pasteAgain: () => void,
): { ok: true; providerId: string } | { ok: false; reason: string } {
  let result = waitForCursorAgentLaunch(registry, paneId, false);
  if (result.ok) return result;
  pasteAgain();
  sleepMs(500);
  acceptCursorTrustDialog(paneId);
  result = waitForCursorAgentLaunch(registry, paneId, true);
  return result;
}

export function waitForClaudeLaunch(
  registry: ProviderRegistry,
  paneId: string,
  retry = false,
): { ok: true; providerId: string } | { ok: false; reason: string } {
  const live = waitForCli(
    registry,
    paneId,
    capturePaneSnapshot,
    retry ? CLAUDE_WAIT_RETRY : CLAUDE_WAIT,
  );
  if (!live || live.providerId !== "claude") {
    return { ok: false, reason: "claude not live (TUI not ready — no auto-mode/❯ yet)" };
  }
  return { ok: true, providerId: live.providerId };
}

export function verifyClaudeAfterPaste(
  _loaded: LoadedProfile,
  registry: ProviderRegistry,
  paneId: string,
  pasteAgain: () => void,
): { ok: true; providerId: string } | { ok: false; reason: string } {
  let result = waitForClaudeLaunch(registry, paneId, false);
  if (result.ok) return result;
  pasteAgain();
  result = waitForClaudeLaunch(registry, paneId, true);
  return result;
}

/**
 * Prove harness after paste (OC / Cursor / Claude). Others: soft ok after short wait.
 */
export function verifyHarnessAfterPaste(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  paneId: string,
  type: string,
  cmd: string | null | undefined,
  pasteAgain: () => void,
): { ok: true; providerId?: string } | { ok: false; reason: string } {
  const t = normalizeHarnessType(type);
  if (isOpenCodeLaunch(t, cmd)) {
    return verifyOpenCodeAfterPaste(loaded, registry, paneId, pasteAgain);
  }
  if (t === "agent") {
    return verifyCursorAgentAfterPaste(loaded, registry, paneId, pasteAgain);
  }
  if (t === "claude") {
    return verifyClaudeAfterPaste(loaded, registry, paneId, pasteAgain);
  }
  return { ok: true };
}

export function registryForProfile(loaded: LoadedProfile): ProviderRegistry {
  return createRegistryForProfile(loaded.profile);
}

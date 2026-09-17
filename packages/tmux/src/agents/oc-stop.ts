import { spawnSync } from "node:child_process";
import type { LoadedProfile, PaneSnapshot, ProviderRegistry } from "@seat-mesh/core";
import { waitForComposerReady } from "@seat-mesh/providers";
import { withPaneInputEnabled } from "../inject/inject.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { injectColdStartDirect } from "../seats/cold-start-inject.js";
import { tmux } from "../lib/tmux-run.js";

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

export function isOpenCodeHarnessType(type: string): boolean {
  const t = type.trim().toLowerCase();
  return (
    t === "opencode" ||
    t === "oc" ||
    t === "oc-proxy" ||
    t === "opencode-main" ||
    t === "ocproxy"
  );
}

const OC_BUSY_RE = /esc interrupt|⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇/i;

export function openCodePaneBusy(captureTail: string | undefined): boolean {
  return OC_BUSY_RE.test(captureTail ?? "");
}

/** Cancel in-flight OC generation — Escape pushes composer back before kill/relaunch. */
export function cancelOpenCodeGeneration(paneId: string, presses = 3): void {
  for (let i = 0; i < presses; i++) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(280);
  }
}

export function waitForOpenCodeIdle(
  paneId: string,
  capture: (paneId: string) => PaneSnapshot | null,
  opts: { maxTries?: number; pollMs?: number } = {},
): boolean {
  const maxTries = opts.maxTries ?? 16;
  const pollMs = opts.pollMs ?? 250;
  for (let i = 0; i < maxTries; i++) {
    const tail = capture(paneId)?.captureTail;
    if (!openCodePaneBusy(tail)) return true;
    sleepMs(pollMs);
  }
  return false;
}

/** Abort in-flight OC generation and wait for composer idle — before paste on live OC. */
export function prepareOpenCodeForPaste(
  paneId: string,
  capture: (paneId: string) => PaneSnapshot | null = capturePaneSnapshot,
): void {
  cancelOpenCodeGeneration(paneId, 3);
  waitForOpenCodeIdle(paneId, capture);
  sleepMs(200);
}

/** Cancel stuck OC generation (Esc×3) then inject cold-start — no full relaunch. */
export function unstickOpenCodeAndPrompt(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  targetLabel: string,
  paneId: string,
): void {
  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", "restarting"]);
  withPaneInputEnabled(paneId, () => prepareOpenCodeForPaste(paneId, capturePaneSnapshot));
  sleepMs(400);

  const snap = capturePaneSnapshot(paneId);
  const prov = snap ? registry.detect(snap) : null;
  if (prov) {
    waitForComposerReady(registry, paneId, capturePaneSnapshot, prov.id, {
      maxTries: 24,
      pollMs: 250,
    });
  }

  injectColdStartDirect(loaded, registry, targetLabel);
  tmux(["set-option", "-p", "-t", paneId, "@mesh_status", ""]);
}

/** Stop live OpenCode: triple-Esc (cancel gen) → idle wait → C-c kill → clear. */
export function stopOpenCodeCli(
  paneId: string,
  capture: (paneId: string) => PaneSnapshot | null,
): void {
  cancelOpenCodeGeneration(paneId, 3);
  waitForOpenCodeIdle(paneId, capture);
  sleepMs(200);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(350);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(250);
  tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
  sleepMs(200);
}

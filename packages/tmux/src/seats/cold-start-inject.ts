import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { composerFromCapture, waitForCli, waitForComposerReady } from "@seat-mesh/providers";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";
import { injectPromptDirect } from "../inject/prompt.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { freshSummonWhoamiPrompt, secretaryColdStartBrief } from "@seat-mesh/core";
import { runWhoami } from "../agents/whoami.js";
import { gateQueuePath, seatFile } from "./seat-paths.js";
import {
  recordColdStartEnqueue,
  seatHubFingerprint,
  shouldSkipColdStartEnqueue,
} from "./cold-start-state.js";
import { cancelOpenCodeGeneration } from "../agents/oc-stop.js";
import { tmux } from "../lib/tmux-run.js";

const PREFIX = "[mesh-cold-start] ";

function freshSummonBody(
  w: ReturnType<typeof runWhoami>,
  providerId?: string | null,
): string {
  if (w.role === "secretary") return PREFIX + secretaryColdStartBrief(providerId);
  return PREFIX + freshSummonWhoamiPrompt(w.role, providerId);
}

function hubPaths(
  loaded: LoadedProfile,
  w: ReturnType<typeof runWhoami>,
  mini: string | null,
): (string | null)[] {
  const role = w.role;
  const target =
    role === "manager"
      ? { role: "manager" as const }
      : role === "secretary"
        ? { role: "secretary" as const }
        : role === "manager-mini" || mini
          ? { role: "manager-mini" as const, mini }
          : {
              role: "worker" as const,
              slot: w.slotLabel ?? (w.slot != null ? String(w.slot) : null),
            };
  return [
    gateQueuePath(loaded),
    seatFile(loaded, target, "FOCUS.md"),
    seatFile(loaded, target, "TASKS.md"),
  ];
}

/** Enqueue cold-start briefing to a pane (daemon inject when idle). Idempotent per hub fingerprint. */
export function enqueueColdStart(
  loaded: LoadedProfile,
  target: string,
  opts: { mini?: string | null; force?: boolean } = {},
): { skipped: boolean; fingerprint: string } {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const w = runWhoami(loaded, target);
  const mini = opts.mini ?? resolved.row.mini ?? null;
  const paths = hubPaths(loaded, w, mini);
  const fingerprint = seatHubFingerprint(loaded, paths);

  const targetLabel =
    resolved.row.role === "manager-mini" && mini
      ? `mini-${mini}`
      : resolved.row.role === "worker" && resolved.row.slot
        ? `slot-${resolved.row.slot}`
        : target;

  if (
    shouldSkipColdStartEnqueue(
      loaded,
      resolved.paneId,
      targetLabel,
      fingerprint,
      { force: opts.force },
    )
  ) {
    return { skipped: true, fingerprint };
  }

  const body = freshSummonBody(w);
  const resp = enqueuePeer(loaded, {
    kind: "prompt",
    msg: body,
    targetPane: resolved.paneId,
    targetLabel,
    fromSlot: "mesh-cold-start",
  });
  if (!resp?.ok) {
    throw new Error("FAIL: cold-start enqueue — run: seatmesh --profile .sm inbox restart");
  }
  recordColdStartEnqueue(loaded, resolved.paneId, targetLabel, fingerprint);
  return { skipped: false, fingerprint };
}

/** Direct inject when CLI is already live (handoff / mini spawn). */
export function injectColdStartDirect(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  opts: { mini?: string | null } = {},
): void {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) throw new Error(resolved.error);
  const w = runWhoami(loaded, target);
  const snap = capturePaneSnapshot(resolved.paneId);
  const prov = snap ? registry.detect(snap) : null;
  const body = freshSummonBody(w, prov?.id ?? null);
  injectPromptDirect(loaded, registry, target, body, {
    prefix: "",
    force: true,
    confirmSent: false,
  });
}

function sleepMs(ms: number): void {
  if (ms > 0) spawnSync("sleep", [String(ms / 1000)]);
}

function briefVisible(paneId: string, target?: string): boolean {
  const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
  if (target === "secretary") return /FRESH SUMMON|You are SECRETARY|mesh-cold-start/i.test(tail);
  return /FRESH SUMMON|sm agent whoami|seatmesh agent whoami|run \.\/sm\.sh whoami|mesh-cold-start/i.test(
    tail,
  );
}

/**
 * After `launch` pastes the CLI cmd: wait for composer, inject FRESH SUMMON / run whoami.
 * Claude/Cursor otherwise boot to an empty prompt with no instructions.
 */
/** Claude TUI must be up — process detect alone matches the launch cmdline too early. */
function launchUiReady(registry: ProviderRegistry, paneId: string, providerId: string): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov || prov.id !== providerId) return false;
  const tail = snap.captureTail;
  if (providerId === "claude") {
    return /auto mode on|⏵⏵/i.test(tail) && /❯/.test(tail);
  }
  if (providerId === "cursor-agent") {
    const state = composerFromCapture(snap, providerId);
    if (state.phase === "limit") return false;
    if (
      /trust (this |the )?workspace|do you trust the authors|workspace trust|accept this workspace/i.test(
        tail,
      )
    ) {
      return false;
    }
    // Blank capture early in boot is ok only after process detect — still require
    // some Agent chrome or composerReady (do not inject into a trust dialog).
    return (
      /Add a follow-up|Plan, search|composer|ctrl\+c to stop|\bAgent\b/i.test(tail) ||
      (state.phase !== "plain_shell" && prov.composerReady(snap)) ||
      (state.phase === "plain_shell" && /agent(\s|$)/i.test(snap.currentCommand ?? ""))
    );
  }
  if (providerId === "opencode") {
    if (/esc exit shell mode/i.test(tail)) return false;
    return prov.composerReady(snap);
  }
  return prov.composerReady(snap);
}

export function injectAfterLaunch(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  paneId: string,
): { ok: boolean; detail: string } {
  const live = waitForCli(registry, paneId, capturePaneSnapshot, {
    maxTries: 40,
    pollMs: 400,
  });
  if (!live) {
    return { ok: false, detail: `no live CLI on ${paneId} after launch` };
  }
  waitForComposerReady(
    registry,
    paneId,
    capturePaneSnapshot,
    live.providerId,
    { maxTries: 40, pollMs: 400 },
  );
  // OpenCode long pastes can leave Shell mode — Esc until composer accepts inject.
  if (live.providerId === "opencode") {
    for (let s = 0; s < 3; s++) {
      const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
      if (!/esc exit shell mode/i.test(tail)) break;
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(280);
    }
    cancelOpenCodeGeneration(paneId, 1);
    sleepMs(200);
  }
  let ui = false;
  for (let i = 0; i < 50; i++) {
    if (launchUiReady(registry, paneId, live.providerId)) {
      ui = true;
      break;
    }
    if (live.providerId === "opencode") {
      const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
      if (/esc exit shell mode/i.test(tail)) {
        tmux(["send-keys", "-t", paneId, "Escape"]);
      }
    }
    sleepMs(400);
  }
  if (!ui && live.providerId === "cursor-agent") {
    // Do not force-inject into a workspace-trust dialog.
    const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
    if (
      !/trust (this |the )?workspace|do you trust the authors|workspace trust|accept this workspace/i.test(
        tail,
      )
    ) {
      ui = true;
    }
  }
  if (!ui) {
    return { ok: false, detail: `TUI not ready (${live.providerId}) on ${paneId} — brief not injected` };
  }
  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      injectColdStartDirect(loaded, registry, target);
      sleepMs(900);
      if (briefVisible(paneId, target)) {
        return {
          ok: true,
          detail: `brief in ${paneId} provider=${live.providerId} attempt=${attempt}`,
        };
      }
      lastErr = "token missing from scrollback";
    } catch (e) {
      lastErr = (e as Error).message;
    }
    sleepMs(700);
  }
  return { ok: false, detail: `brief failed on ${paneId}: ${lastErr}` };
}

/**
 * One-shot brief for wave launch — no long waits. Caller round-robins panes
 * so many OC composers can finish booting in parallel.
 */
export function tryBriefOnce(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  paneId: string,
): { ok: boolean; ready: boolean; detail: string } {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return { ok: false, ready: false, detail: `no snapshot on ${paneId}` };
  const prov = registry.detect(snap);
  if (!prov) return { ok: false, ready: false, detail: `no live CLI on ${paneId}` };
  if (prov.id === "opencode") {
    const tail = snap.captureTail ?? "";
    if (/esc exit shell mode/i.test(tail)) {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      return { ok: false, ready: false, detail: "opencode shell-mode" };
    }
  }
  if (!launchUiReady(registry, paneId, prov.id)) {
    return { ok: false, ready: false, detail: `TUI not ready (${prov.id})` };
  }
  try {
    injectColdStartDirect(loaded, registry, target);
    sleepMs(500);
    if (briefVisible(paneId, target)) {
      return {
        ok: true,
        ready: true,
        detail: `brief in ${paneId} provider=${prov.id} attempt=1`,
      };
    }
    return { ok: false, ready: true, detail: "token missing from scrollback" };
  } catch (e) {
    return { ok: false, ready: true, detail: (e as Error).message };
  }
}

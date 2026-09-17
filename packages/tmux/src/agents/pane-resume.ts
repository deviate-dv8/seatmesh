import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { entryWantsProxyRecovery, lookupResolvedKind } from "@seat-mesh/core";
import {
  extractOpenCodeSession,
  formatOpenCodeResumeCommand,
  normalizeOpenCodeSessionId,
  resolveOpenCodeSessionForPane,
} from "@seat-mesh/providers";
import { resolvePaneTarget, type PaneRow } from "../lib/resolve-pane.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { injectToPane, withPaneInputEnabled } from "../inject/inject.js";
import { seatAgentEntry, seatIdFromPaneRow } from "./agents-state.js";
import { defaultHarnessTypeForSeat, kindsForLoaded } from "./agent-launch.js";
import { syncOpenCodePaneSession } from "./oc-session-sync.js";
import { isOpenCodeCpeResumeCmd } from "../session/save-session.js";
import { prepareOpenCodeForPaste, isOpenCodeHarnessType } from "./oc-stop.js";
import { runSwitch } from "./switch.js";
import { tmux } from "../lib/tmux-run.js";

function seatLabelFromRow(row: PaneRow): string {
  const id = seatIdFromPaneRow(row);
  if (id) return id;
  if (row.role) return row.role;
  if (row.slot) return `slot-${row.slot}`;
  if (row.mini) return `mini-${row.mini}`;
  return "here";
}

function providerIdToHarnessType(id: string): string {
  if (id === "cursor-agent") return "agent";
  if (id === "opencode") return "opencode";
  return id;
}

/** Prefer prove-kind (CPE) when mesh-agents / resumeCmd say so. */
function resolveHarnessType(
  loaded: LoadedProfile,
  seatId: string,
  liveType: string,
  saved: ReturnType<typeof seatAgentEntry>,
): string {
  const kinds = kindsForLoaded(loaded);
  if (entryWantsProxyRecovery(saved, kinds)) {
    const byType = saved?.type ? lookupResolvedKind(kinds, saved.type) : undefined;
    if (byType?.recovery?.onProxyUp || byType?.prove) return byType.id;
    return lookupResolvedKind(kinds, "opencode-cpe")?.id ?? "opencode-cpe";
  }
  if (saved?.type === "opencode-cpe" || isOpenCodeCpeResumeCmd(saved?.resume_cmd)) {
    return "opencode-cpe";
  }
  if (liveType === "opencode" || liveType === "opencode-cpe") {
    return liveType === "opencode-cpe" ? "opencode-cpe" : "opencode";
  }
  if (saved?.type && saved.type !== "empty") {
    return saved.type === "cursor-agent" ? "agent" : saved.type;
  }
  const def = defaultHarnessTypeForSeat(loaded, seatId);
  return def === "cursor-agent" ? "agent" : def;
}

/**
 * Autodetect OpenCode ses_* (or Claude resume id) for a pane.
 * Order: live cmdline → @mesh_oc_session → scrollback → mesh-agents → sync scrape.
 */
export function detectPaneResumeId(
  loaded: LoadedProfile,
  paneId: string,
  seatId: string,
): { sessionId: string | null; source: string } {
  const snap = capturePaneSnapshot(paneId);
  if (snap) {
    const fromLive = resolveOpenCodeSessionForPane(snap);
    if (fromLive) return { sessionId: fromLive, source: "pane-live" };
  }

  const saved = seatAgentEntry(loaded, seatId);
  const fromSavedId = normalizeOpenCodeSessionId(saved?.resume_id ?? undefined);
  if (fromSavedId) return { sessionId: fromSavedId, source: "mesh-agents.resume_id" };

  if (saved?.resume_cmd) {
    const fromCmd = normalizeOpenCodeSessionId(extractOpenCodeSession(saved.resume_cmd));
    if (fromCmd) return { sessionId: fromCmd, source: "mesh-agents.resume_cmd" };
  }

  const synced = syncOpenCodePaneSession(paneId, { waitMs: 400, retries: 1 });
  if (synced) return { sessionId: synced, source: "sync-scrape" };

  return { sessionId: null, source: "none" };
}

export interface PaneResumeResult {
  ok: boolean;
  mode: "inject" | "relaunch" | "none";
  paneId: string;
  target: string;
  sessionId: string | null;
  harnessType: string;
  detail: string;
}

/**
 * `sm pane resume [target]` — find original session id on the pane and resume it.
 * Live OpenCode → paste `resume [ses_…]`. Else relaunch harness with --keep-resume.
 */
export function runPaneResume(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  targetRaw?: string,
): PaneResumeResult {
  const targetArg = (targetRaw ?? "here").trim() || "here";
  const resolved = resolvePaneTarget(targetArg, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const { paneId, row } = resolved;
  const target = seatLabelFromRow(row);
  const saved = seatAgentEntry(loaded, target);
  const snapBefore = capturePaneSnapshot(paneId);
  const liveProv = snapBefore ? registry.detect(snapBefore) : null;
  const liveType = liveProv ? providerIdToHarnessType(liveProv.id) : "empty";
  const harnessType = resolveHarnessType(loaded, target, liveType, saved);

  let { sessionId, source } = detectPaneResumeId(loaded, paneId, target);

  // Non-OC: use provider detection resumeId (Claude UUID etc.)
  if (!sessionId && liveProv && snapBefore) {
    const det = liveProv.detect(snapBefore);
    if (det?.resumeId?.trim()) {
      sessionId = det.resumeId.trim();
      source = `live.${liveProv.id}`;
    }
  }
  if (!sessionId && saved?.resume_id?.trim() && !normalizeOpenCodeSessionId(saved.resume_id)) {
    sessionId = saved.resume_id.trim();
    source = "mesh-agents.resume_id";
  }

  if (!sessionId) {
    return {
      ok: false,
      mode: "none",
      paneId,
      target,
      sessionId: null,
      harnessType,
      detail: "no session id on pane (cmdline / @mesh_oc_session / scrollback / mesh-agents)",
    };
  }

  // Live OpenCode → inject resume [ses_*]
  if (liveProv?.id === "opencode" && normalizeOpenCodeSessionId(sessionId)) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", sessionId]);
    const snap = capturePaneSnapshot(paneId)!;
    const cmd = formatOpenCodeResumeCommand({
      ...snap,
      options: { ...snap.options, mesh_oc_session: sessionId },
    });
    if (!cmd) {
      return {
        ok: false,
        mode: "inject",
        paneId,
        target,
        sessionId,
        harnessType,
        detail: "could not format resume command",
      };
    }
    withPaneInputEnabled(paneId, () => {
      prepareOpenCodeForPaste(paneId, capturePaneSnapshot);
      injectToPane(
        paneId,
        cmd,
        liveProv.injectPlan(snap),
        liveProv.id,
        snap.captureTail,
        snap.captureTailAnsi,
      );
    });
    return {
      ok: true,
      mode: "inject",
      paneId,
      target,
      sessionId,
      harnessType: harnessType === "opencode-cpe" ? "opencode-cpe" : "opencode",
      detail: `${cmd} (via ${source})`,
    };
  }

  // Dead / wrong CLI / shell → relaunch with keep-resume
  if (!isOpenCodeHarnessType(harnessType) && harnessType !== "claude" && harnessType !== "agent") {
    return {
      ok: false,
      mode: "none",
      paneId,
      target,
      sessionId,
      harnessType,
      detail: `harness ${harnessType} has no resume path — pass: switch ${target} <cli> --keep-resume`,
    };
  }

  runSwitch(loaded, registry, target, harnessType, {
    fresh: false,
    resumeId: sessionId,
    reason: `pane resume (${source})`,
  });

  return {
    ok: true,
    mode: "relaunch",
    paneId,
    target,
    sessionId,
    harnessType,
    detail: `relaunch ${harnessType} --session ${sessionId} (via ${source})`,
  };
}

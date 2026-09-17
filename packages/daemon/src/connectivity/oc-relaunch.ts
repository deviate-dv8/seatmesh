import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  injectToPane,
  isOpenCodeCpeResumeCmd,
  listMeshMonitorPanes,
  loadLaunchState,
  prepareOpenCodeForPaste,
  resolveLaunchCmd,
  seatAgentEntry,
  tryLaunchPane,
  withPaneInputEnabled,
} from "@seat-mesh/tmux";

/** Direct composer paste — oc-proxy recovery is outside mesh-inbox/peer. */
export const OC_PROXY_CONTINUE =
  "CONTINUE after oc-proxy revive — finish open TASKS. Stay on oc-proxy (opencode-cpe / :18887). Do not wait for operator.";

function isOcProxySeat(entry: { type?: string; resume_cmd?: string | null } | null): boolean {
  if (!entry) return false;
  if (entry.type === "oc-proxy") return true;
  return isOpenCodeCpeResumeCmd(entry.resume_cmd);
}

/**
 * After oc-reset kills CPE OpenCode: relaunch oc-proxy seats from mesh-agents
 * (keep resume). CONTINUE is a direct OpenCode inject — not inbox/peer.
 */
export function relaunchOcProxyAfterReset(
  loaded: LoadedProfile,
  registry: ProviderRegistry | null,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  log?: (line: string) => void,
): { sent: number; total: number; sentPaneIds: string[] } {
  const state = loadLaunchState(loaded);
  const panes = listMeshMonitorPanes(session, baseWindow, workersWindow, minisWindow);
  let sent = 0;
  let total = 0;
  const sentPaneIds: string[] = [];

  for (const p of panes) {
    const seatId = p.label;
    if (!seatId) continue;
    const entry = seatAgentEntry(loaded, seatId, state);
    if (!isOcProxySeat(entry)) continue;
    total += 1;
    const cmd =
      resolveLaunchCmd(
        {
          type: "oc-proxy",
          resume_id: entry?.resume_id ?? null,
          resume_cmd: entry?.resume_cmd ?? null,
        },
        loaded.workspace,
        loaded,
      ) ?? null;
    if (!cmd) {
      log?.(`OC-RELAUNCH skip ${seatId}: no launch cmd`);
      continue;
    }
    const result = tryLaunchPane(loaded, p.paneId, seatId, cmd, false, "oc-proxy");
    if (result.status !== "launched") {
      log?.(`OC-RELAUNCH fail ${seatId} ${p.paneId}: ${result.reason ?? result.status}`);
      continue;
    }
    // Wait briefly for OC composer, then paste CONTINUE directly (no inbox).
    if (registry) {
      const ok = directInjectContinue(registry, p.paneId, OC_PROXY_CONTINUE);
      if (!ok) log?.(`OC-RELAUNCH CONTINUE direct-inject miss ${seatId} ${p.paneId}`);
    }
    sent += 1;
    sentPaneIds.push(p.paneId);
    log?.(`OC-RELAUNCH ${seatId} ${p.paneId}`);
  }

  return { sent, total, sentPaneIds };
}

/** Paste CONTINUE into a live OpenCode pane — outside mesh-inbox. */
export function directInjectContinue(
  registry: ProviderRegistry,
  paneId: string,
  message: string = OC_PROXY_CONTINUE,
): boolean {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return false;
  const prov = registry.detect(snap);
  if (!prov || prov.id !== "opencode") return false;
  const plan = prov.injectPlan(snap);
  let ok = false;
  withPaneInputEnabled(paneId, () => {
    prepareOpenCodeForPaste(paneId, capturePaneSnapshot);
    injectToPane(paneId, message, plan, prov.id, snap.captureTail, snap.captureTailAnsi);
    ok = true;
  });
  return ok;
}

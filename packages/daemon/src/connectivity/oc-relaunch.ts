import { spawnSync } from "node:child_process";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  injectToPane,
  isOpenCodeCpeResumeCmd,
  listMeshMonitorPanes,
  loadLaunchState,
  pasteHarnessLaunchCmd,
  prepareOpenCodeForPaste,
  resolveLaunchCmd,
  seatAgentEntry,
  tryBriefOnce,
  withPaneInputEnabled,
  registryForProfile,
  verifyHarnessAfterPaste,
} from "@seat-mesh/tmux";

/** Direct composer paste — oc-proxy recovery is outside mesh-inbox/peer. */
export const OC_PROXY_CONTINUE =
  "CONTINUE after oc-proxy revive — finish open TASKS. Stay on oc-proxy (opencode-cpe / :18887). Do not wait for operator.";

function isOcProxySeat(entry: { type?: string; resume_cmd?: string | null } | null): boolean {
  if (!entry) return false;
  if (entry.type === "oc-proxy") return true;
  return isOpenCodeCpeResumeCmd(entry.resume_cmd);
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

/**
 * After oc-reset kills CPE OpenCode: paste all oc-proxy seats first (parallel boot),
 * then round-robin briefs + CONTINUE. Avoids sequential wait-per-pane.
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
  const reg = registry ?? registryForProfile(loaded);
  const jobs: Array<{ seatId: string; paneId: string; cmd: string }> = [];

  for (const p of panes) {
    const seatId = p.label;
    if (!seatId) continue;
    const entry = seatAgentEntry(loaded, seatId, state);
    if (!isOcProxySeat(entry)) continue;
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
    jobs.push({ seatId, paneId: p.paneId, cmd });
  }

  const total = jobs.length;
  if (total === 0) return { sent: 0, total: 0, sentPaneIds: [] };

  // Phase 1: paste every seat quickly so OC boots in parallel.
  log?.(`OC-RELAUNCH paste wave n=${total}`);
  for (const job of jobs) {
    try {
      pasteHarnessLaunchCmd(loaded, job.paneId, "oc-proxy", job.cmd);
      const verified = verifyHarnessAfterPaste(loaded, reg, job.paneId, "oc-proxy", job.cmd, () =>
        pasteHarnessLaunchCmd(loaded, job.paneId, "oc-proxy", job.cmd),
      );
      if (!verified.ok) {
        log?.(`OC-RELAUNCH paste-verify soft ${job.seatId}: ${verified.reason}`);
      }
    } catch (e) {
      log?.(`OC-RELAUNCH paste fail ${job.seatId}: ${(e as Error).message}`);
    }
  }

  // Phase 2: round-robin brief + CONTINUE (panes finish boot together).
  const pending = new Map(
    jobs.map((j) => [j.paneId, { ...j, attempts: 0, done: false }]),
  );
  const sentPaneIds: string[] = [];
  const deadline = Date.now() + 180_000;
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [paneId, job] of [...pending]) {
      const brief = tryBriefOnce(loaded, reg, job.seatId, paneId);
      if (!brief.ok) {
        if (brief.ready) job.attempts += 1;
        if (job.attempts >= 4) {
          log?.(`OC-RELAUNCH brief soft-fail ${job.seatId}: ${brief.detail}`);
          // Still CONTINUE if composer is up — brief is best-effort.
          if (directInjectContinue(reg, paneId, OC_PROXY_CONTINUE)) {
            sentPaneIds.push(paneId);
            log?.(`OC-RELAUNCH ${job.seatId} ${paneId} (continue-without-brief)`);
          }
          pending.delete(paneId);
        }
        continue;
      }
      log?.(`OC-RELAUNCH brief ok ${job.seatId}: ${brief.detail}`);
      if (directInjectContinue(reg, paneId, OC_PROXY_CONTINUE)) {
        sentPaneIds.push(paneId);
        log?.(`OC-RELAUNCH ${job.seatId} ${paneId}`);
      } else {
        log?.(`OC-RELAUNCH CONTINUE miss ${job.seatId} ${paneId}`);
      }
      pending.delete(paneId);
    }
    if (pending.size > 0) sleepMs(400);
  }
  for (const [paneId, job] of pending) {
    log?.(`OC-RELAUNCH timeout ${job.seatId} ${paneId}`);
    if (directInjectContinue(reg, paneId, OC_PROXY_CONTINUE)) {
      sentPaneIds.push(paneId);
    }
  }

  return { sent: sentPaneIds.length, total, sentPaneIds };
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

import { spawnSync } from "node:child_process";
import {
  continueCopyForKind,
  entryWantsProxyRecovery,
  lookupResolvedKind,
  type LoadedProfile,
  type ProviderRegistry,
} from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  injectToPane,
  kindsForLoaded,
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

/** Fallback CONTINUE when kind.recovery.continueCopy unset. */
export const OC_CPE_CONTINUE =
  "CONTINUE after CPE revive — finish open TASKS. Stay on CPE OpenCode (opencode-cpe / :18887). Do not wait for operator.";

/** Atomic 4 — OrcaRouter insufficient_user_quota blip (not CPE reboot). */
export const OC_CREDIT_CONTINUE =
  "CONTINUE — OrcaRouter credit gate blipped (insufficient_user_quota). Retry the last turn. Stay on CPE OpenCode (opencode-cpe / :18887).";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

/**
 * After oc-reset kills CPE OpenCode: paste recovery seats first (parallel boot),
 * then round-robin briefs + CONTINUE. Avoids sequential wait-per-pane.
 * Seat selection = kind.recovery.onProxyUp (opencode-cpe extends opencode by default).
 */
export function relaunchOpenCodeCpeAfterReset(
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
  const kinds = kindsForLoaded(loaded);
  const jobs: Array<{ seatId: string; paneId: string; cmd: string; harnessType: string; continueMsg: string }> =
    [];

  for (const p of panes) {
    const seatId = p.label;
    if (!seatId) continue;
    const entry = seatAgentEntry(loaded, seatId, state);
    if (!entryWantsProxyRecovery(entry, kinds)) continue;
    const harnessType = entry?.type && lookupResolvedKind(kinds, entry.type) ? entry.type : "opencode-cpe";
    const kind = lookupResolvedKind(kinds, harnessType);
    const continueMsg = continueCopyForKind(kind, OC_CPE_CONTINUE);
    const cmd =
      resolveLaunchCmd(
        {
          type: harnessType,
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
    jobs.push({ seatId, paneId: p.paneId, cmd, harnessType, continueMsg });
  }

  const total = jobs.length;
  if (total === 0) return { sent: 0, total: 0, sentPaneIds: [] };

  log?.(`OC-RELAUNCH paste wave n=${total}`);
  for (const job of jobs) {
    try {
      pasteHarnessLaunchCmd(loaded, job.paneId, job.harnessType, job.cmd);
      const verified = verifyHarnessAfterPaste(
        loaded,
        reg,
        job.paneId,
        job.harnessType,
        job.cmd,
        () => pasteHarnessLaunchCmd(loaded, job.paneId, job.harnessType, job.cmd),
      );
      if (!verified.ok) {
        log?.(`OC-RELAUNCH paste-verify soft ${job.seatId}: ${verified.reason}`);
      }
    } catch (e) {
      log?.(`OC-RELAUNCH paste fail ${job.seatId}: ${(e as Error).message}`);
    }
  }

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
          if (directInjectContinue(reg, paneId, job.continueMsg)) {
            sentPaneIds.push(paneId);
            log?.(`OC-RELAUNCH ${job.seatId} ${paneId} (continue-without-brief)`);
          }
          pending.delete(paneId);
        }
        continue;
      }
      log?.(`OC-RELAUNCH brief ok ${job.seatId}: ${brief.detail}`);
      if (directInjectContinue(reg, paneId, job.continueMsg)) {
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
    if (directInjectContinue(reg, paneId, job.continueMsg)) {
      sentPaneIds.push(paneId);
    }
  }

  return { sent: sentPaneIds.length, total, sentPaneIds };
}

/** Paste CONTINUE into a live OpenCode pane — outside mesh-inbox. */
export function directInjectContinue(
  registry: ProviderRegistry,
  paneId: string,
  message: string = OC_CPE_CONTINUE,
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

/**
 * Atomic 4 for OrcaRouter credit gate: Esc out of error chrome, then CONTINUE.
 * Uses OC_CREDIT_CONTINUE copy (not revive wording).
 */
export function continueOcCreditSeat(
  registry: ProviderRegistry,
  paneId: string,
  log?: (line: string) => void,
): boolean {
  withPaneInputEnabled(paneId, () => {
    prepareOpenCodeForPaste(paneId, capturePaneSnapshot);
  });
  let ok = directInjectContinue(registry, paneId, OC_CREDIT_CONTINUE);
  if (!ok) {
    spawnSync("sleep", ["2"]);
    ok = directInjectContinue(registry, paneId, OC_CREDIT_CONTINUE);
  }
  log?.(
    ok
      ? `OC-CREDIT CONTINUE direct ${paneId}`
      : `OC-CREDIT CONTINUE miss ${paneId}`,
  );
  return ok;
}

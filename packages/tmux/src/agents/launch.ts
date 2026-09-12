import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "seat-mesh-core";
import { extractOpenCodeSession, normalizeOpenCodeSessionId } from "seat-mesh-providers";
import { withPaneInputEnabled } from "../inject/inject.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import {
  isOpenCodeLaunch,
  registryForProfile,
  verifyOpenCodeAfterPaste,
} from "./launch-verify.js";
import {
  loadLaunchState,
  loadMeshAgents,
  miniStateForN,
  resolveLaunchCmd,
  workerStateForSlot,
} from "./agents-state.js";
import { resolveLiveTmuxSession } from "../lib/live-session.js";
import { ensureMeshSessionEnv } from "../session/session-env.js";
import { tmux } from "../lib/tmux-run.js";
import {
  coordPaneForRole,
  meshManagerPane,
  meshSecretaryPane,
  resolveWorkerPaneId,
} from "../lib/pane-meta.js";
import { baseColumns, cliForBaseColumn } from "../session/base-layout.js";
import { listWindowPaneIds, resolveMiniPaneId } from "../session/window-panes.js";
export interface LaunchResult {
  paneId: string;
  label: string;
  status: "launched" | "skipped" | "failed";
  cmd?: string;
  reason?: string;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

function providerIdToHarnessType(id: string): string {
  if (id === "cursor-agent") return "agent";
  return id;
}

/** Stop a live CLI before pasting a different type (claude -> opencode, etc.). */
function stopLiveCli(paneId: string, oldType: string): void {
  if (oldType === "kiro") {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(300);
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(300);
  }
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(350);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(250);
  tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
  sleepMs(200);
}

function resolveMiniHarnessType(savedType: string | undefined, miniCli: string): string {
  const base = !savedType || savedType === "empty" ? miniCli : savedType;
  return base === "cursor-agent" ? "agent" : base;
}


function stampOpenCodeSession(paneId: string, cmd: string): void {
  const sid = normalizeOpenCodeSessionId(extractOpenCodeSession(cmd));
  if (sid) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", sid]);
  }
}

/** Paste a launch one-liner into the pane (no OC verify — use tryLaunch for that). */
export function pasteLaunchCmd(paneId: string, cmd: string): void {
  stampOpenCodeSession(paneId, cmd);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(180);
  tmux(["send-keys", "-t", paneId, "C-c"]);
  sleepMs(180);
  tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
  sleepMs(250);
  tmux(["send-keys", "-t", paneId, "-l", cmd]);
  sleepMs(80);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

/** @deprecated alias — prefer pasteLaunchCmd + tryLaunch (OC verify is not optional). */
export function sendLaunch(paneId: string, cmd: string): void {
  pasteLaunchCmd(paneId, cmd);
}

export function tryLaunchPane(
  loaded: LoadedProfile,
  paneId: string,
  label: string,
  cmd: string | null,
  skipEmpty: boolean,
  type: string,
): LaunchResult {
  if (!cmd) {
    return {
      paneId,
      label,
      status: "skipped",
      reason: skipEmpty && type === "empty" ? "empty seat" : "no launch command",
    };
  }
  try {
    const registry = registryForProfile(loaded);
    const snap = capturePaneSnapshot(paneId);
    const liveProv = snap ? registry.detect(snap) : null;
    const liveType = liveProv ? providerIdToHarnessType(liveProv.id) : "empty";
    withPaneInputEnabled(paneId, () => {
      if (liveType !== "empty" && liveType !== type) {
        stopLiveCli(paneId, liveType);
      }
      pasteLaunchCmd(paneId, cmd);
    });

    if (!isOpenCodeLaunch(type, cmd)) {
      return { paneId, label, status: "launched", cmd };
    }

    const verified = verifyOpenCodeAfterPaste(loaded, registry, paneId, () =>
      withPaneInputEnabled(paneId, () => pasteLaunchCmd(paneId, cmd)),
    );
    if (!verified.ok) {
      return {
        paneId,
        label,
        status: "failed",
        reason: `${label}: ${verified.reason}`,
        cmd,
      };
    }
    return { paneId, label, status: "launched", cmd };
  } catch (e) {
    return {
      paneId,
      label,
      status: "failed",
      reason: (e as Error).message,
    };
  }
}

export interface LaunchOptions {
  /** manager | secretary | worker slot number | all */
  targets?: string[];
}

export function launchSession(
  loaded: LoadedProfile,
  opts: LaunchOptions = {},
): LaunchResult[] {
  let active = loaded;
  const session = resolveLiveTmuxSession(active);
  const layout = active.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  ensureMeshSessionEnv(session, {
    workspaceId: active.workspaceId,
    sessionName: active.sessionName,
  });

  const state = loadLaunchState(
    active.workspace,
    active.profile.state.meshAgentsJson,
    active.profile.state.agentsJson,
  );
  const skipEmpty = state.conventions?.launch_skips_empty ?? true;
  const wantAll = !opts.targets?.length;
  const want = new Set((opts.targets ?? []).map((t) => t.toLowerCase()));

  const results: LaunchResult[] = [];

  const basePanes = listWindowPaneIds(session, layout.base.window);

  if (want.has("manager-b") || want.has("master-b") || want.has("co-manager")) {
    console.warn("manager-b removed — use a worker slot or ./sm.sh room say -r managers for coordination");
  }

  if (wantAll || want.has("manager") || want.has("master")) {
    const pane = meshManagerPane(session, layout.base.window) ?? basePanes[0];
    if (pane && state.manager) {
      const cmd = resolveLaunchCmd(state.manager, active.workspace);
      results.push(
        tryLaunchPane(active, pane, "manager", cmd, skipEmpty, state.manager.type),
      );
    }
  }

  const meshForCoord = loadMeshAgents(
    loaded.workspace,
    loaded.profile.state.meshAgentsJson,
  );
  if (wantAll || want.has("manager-2") || want.has("manager2")) {
    const pane = coordPaneForRole(session, layout.base.window, "manager-2");
    if (pane) {
      const profileCli = cliForBaseColumn(loaded, "manager-2");
      const harnessType = profileCli === "cursor-agent" ? "agent" : profileCli;
      const saved = meshForCoord?.manager2 ?? meshForCoord?.manager;
      const entry = {
        type: harnessType,
        resume_id: saved?.type === harnessType ? (saved.resumeId ?? null) : null,
        resume_cmd: saved?.type === harnessType ? (saved.resumeCmd ?? null) : null,
      };
      const cmd =
        resolveLaunchCmd({ ...entry, type: harnessType }, loaded.workspace) ??
        buildAgentLaunchCmd(harnessType, loaded.workspace, entry.resume_id);
      results.push(tryLaunchPane(loaded, pane, "manager-2", cmd, skipEmpty, harnessType));
    }
  }

  if (wantAll || want.has("secretary")) {
    const pane = meshSecretaryPane(session, layout.base.window) ?? basePanes[1];
    if (pane) {
      const secType =
        state.conventions?.secretary_default_cli ??
        state.secretary?.type ??
        "opencode";
      const wanted = state.secretary?.wanted ?? true;
      if (!wanted) {
        results.push({
          paneId: pane,
          label: "secretary",
          status: "skipped",
          reason: "secretary not wanted",
        });
      } else {
        const harnessType = secType === "cursor-agent" ? "agent" : secType;
        const secEntry = {
          type: harnessType,
          resume_id: state.secretary?.resume_id ?? null,
          resume_cmd: state.secretary?.resume_cmd ?? null,
        };
        const cmd =
          resolveLaunchCmd(secEntry, loaded.workspace) ??
          buildAgentLaunchCmd(harnessType, loaded.workspace, secEntry.resume_id);
        results.push(tryLaunchPane(loaded, pane, "secretary", cmd, skipEmpty, harnessType));
      }
    }
  }

  const miniMax = loaded.profile.session.miniMax;
  const miniCli =
    state.conventions?.mini_default_cli ??
    state.conventions?.secretary_default_cli ??
    "opencode";
  const mesh = loadMeshAgents(loaded.workspace, loaded.profile.state.meshAgentsJson);
  const wantMinis =
    wantAll || want.has("minis") || want.has("mini") || [...want].some((t) => t.startsWith("mini-"));
  if (wantMinis) {
    for (let n = 1; n <= miniMax; n++) {
      const key = `mini-${n}`;
      if (!wantAll && !want.has("minis") && !want.has(key) && !want.has(String(n))) continue;
      const pane = resolveMiniPaneId(session, layout.minis.window, n);
      if (!pane) continue;
      const saved = mesh ? miniStateForN(mesh, n) : undefined;
      const harnessType = resolveMiniHarnessType(saved?.type, miniCli);
      const entry = {
        type: harnessType,
        resume_id: saved?.resumeId ?? null,
        resume_cmd: saved?.resumeCmd ?? null,
      };
      const cmd =
        resolveLaunchCmd(entry, loaded.workspace) ??
        buildAgentLaunchCmd(harnessType, loaded.workspace, entry.resume_id);
      results.push(tryLaunchPane(loaded, pane, key, cmd, false, harnessType));
    }
  }

  const workerCount = loaded.profile.session.workerCount;
  for (let slot = 1; slot <= workerCount; slot++) {
    const key = String(slot);
    const slotKey = `slot-${slot}`;
    if (!wantAll && !want.has(key) && !want.has(slotKey) && !want.has("workers") && !want.has("all")) {
      continue;
    }
    const pane =
      resolveWorkerPaneId(session, layout.workers.window, slot) ??
      listWindowPaneIds(session, layout.workers.window)[slot - 1];
    if (!pane) continue;
    const entry = workerStateForSlot(state, slot);
    if (!entry) {
      results.push({
        paneId: pane,
        label: `slot-${slot}`,
        status: "skipped",
        reason: "no agents json entry",
      });
      continue;
    }
    if (skipEmpty && entry.type === "empty") {
      results.push({
        paneId: pane,
        label: `slot-${slot}`,
        status: "skipped",
        reason: "empty seat",
      });
      continue;
    }
    const cmd = resolveLaunchCmd(entry, loaded.workspace);
    results.push(tryLaunchPane(loaded, pane, `slot-${slot}`, cmd, skipEmpty, entry.type));
  }

  return results;
}

export function printLaunchResults(results: LaunchResult[]): void {
  for (const r of results) {
    const cmd = r.cmd ? ` cmd=${r.cmd.slice(0, 72)}${r.cmd.length > 72 ? "…" : ""}` : "";
    const why = r.reason ? ` (${r.reason})` : "";
    console.log(`${r.label}\t${r.paneId}\t${r.status}${why}${r.status === "launched" ? cmd : ""}`);
  }
  const launched = results.filter((r) => r.status === "launched").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`--- launch: ${launched} launched, ${skipped} skipped, ${failed} failed`);
}

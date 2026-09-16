import { spawnSync } from "node:child_process";
import {
  baseColumnIds,
  expandColumnAlias,
  primaryManagerColumn,
  primarySecretaryColumn,
  type LoadedProfile,
} from "@seat-mesh/core";
import { extractOpenCodeSession, normalizeOpenCodeSessionId, waitForCli } from "@seat-mesh/providers";
import { withPaneInputEnabled } from "../inject/inject.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { syncOpenCodePaneSession } from "./oc-session-sync.js";
import { buildProfileLaunchCmd } from "./agent-launch.js";
import {
  isOpenCodeLaunch,
  registryForProfile,
  verifyHarnessAfterPaste,
} from "./launch-verify.js";
import {
  loadLaunchState,
  loadMeshAgentsForProfile,
  resolveLaunchCmd,
  seatAgentEntry,
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
import { injectAfterLaunch } from "../seats/cold-start-inject.js";
import { saveMeshSession } from "../session/save-session.js";
import { isOpenCodeHarnessType, prepareOpenCodeForPaste, stopOpenCodeCli } from "./oc-stop.js";
import { liveHarnessSatisfiesWanted, resolveOpenCodeHarnessType } from "./oc-proxy-live.js";
import { pasteWelcomeScript } from "../session/welcome-paste.js";
export interface LaunchResult {
  paneId: string;
  label: string;
  status: "launched" | "skipped" | "failed";
  cmd?: string;
  reason?: string;
  detail?: string;
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
  if (isOpenCodeHarnessType(oldType)) {
    stopOpenCodeCli(paneId, capturePaneSnapshot);
    return;
  }
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

/** One launch-cmd path for manager / secretary / coord / mini / worker. */
function launchCmdForSeat(
  loaded: LoadedProfile,
  seatId: string,
  harnessType: string,
  state = loadLaunchState(loaded),
): string | null {
  const saved = seatAgentEntry(loaded, seatId, state);
  const entry = {
    type: harnessType,
    resume_id: saved?.resume_id ?? null,
    resume_cmd: saved?.resume_cmd ?? null,
  };
  return (
    resolveLaunchCmd(entry, loaded.workspace, loaded) ??
    buildProfileLaunchCmd(harnessType, loaded, entry.resume_id)
  );
}


function stampOpenCodeSession(paneId: string, cmd: string): void {
  const sid = normalizeOpenCodeSessionId(extractOpenCodeSession(cmd));
  if (sid) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", sid]);
  }
}

/** Paste a launch one-liner into the pane (no OC verify — use tryLaunch for that). */
export function pasteLaunchCmd(paneId: string, cmd: string, harnessType?: string): void {
  stampOpenCodeSession(paneId, cmd);
  if (isOpenCodeLaunch(harnessType ?? "", cmd)) {
    prepareOpenCodeForPaste(paneId, capturePaneSnapshot);
  } else {
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(180);
    tmux(["send-keys", "-t", paneId, "C-c"]);
    sleepMs(180);
  }
  tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
  sleepMs(250);
  tmux(["send-keys", "-t", paneId, "-l", cmd]);
  sleepMs(80);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

/** Paste harness launch — Esc×3 for live OC; welcome script for long oc-proxy one-liners. */
export function pasteHarnessLaunchCmd(
  loaded: LoadedProfile,
  paneId: string,
  harnessType: string,
  cmd: string,
): void {
  if (isOpenCodeLaunch(harnessType, cmd) && cmd.includes("opencode-cpe.sh")) {
    pasteWelcomeScript(loaded, paneId, cmd, {
      tag: `oc-${paneId.replace(/[^a-zA-Z0-9]/g, "_")}`,
    });
    stampOpenCodeSession(paneId, cmd);
    return;
  }
  pasteLaunchCmd(paneId, cmd, harnessType);
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
    const detectId = liveProv?.id ?? "empty";
    const saved = seatAgentEntry(loaded, label);
    // CPE child detects as opencode — use mesh-agents / snap, never the *new* launch cmd.
    const liveType = resolveOpenCodeHarnessType({
      detectId,
      savedType: saved?.type,
      resumeCmd: saved?.resume_cmd,
      snap,
    });
    const satisfyOpts = { savedType: saved?.type, resumeCmd: saved?.resume_cmd };
    if (liveType !== "empty" && liveHarnessSatisfiesWanted(liveType, type, snap, satisfyOpts)) {
      // Fast path: pane already runs the wanted harness (incl. CPE OC for oc-proxy).
      const live = waitForCli(registry, paneId, capturePaneSnapshot, {
        maxTries: 4,
        pollMs: 250,
        requireComposerReady: true,
      });
      if (live) {
        if (isOpenCodeLaunch(type, cmd)) {
          syncOpenCodePaneSession(paneId, { waitMs: 1500, retries: 1 });
        }
        const brief = injectAfterLaunch(loaded, registry, label, paneId);
        if (!brief.ok) {
          console.error(`WARN: post-launch brief ${label}: ${brief.detail}`);
        } else {
          console.log(`OK: post-launch brief ${label} ${brief.detail}`);
        }
        return { paneId, label, status: "launched", cmd, detail: "already-live" };
      }
      // Fall through: same type but not live/ready (crash residue) -> relaunch.
      console.log(`relaunch ${label}: ${type} present but not ready, re-pasting`);
    }
    withPaneInputEnabled(paneId, () => {
      if (liveType !== "empty" && !liveHarnessSatisfiesWanted(liveType, type, snap, satisfyOpts)) {
        stopLiveCli(paneId, liveType === "oc-proxy" ? "opencode" : liveType);
      }
    });
    // oc-proxy / long CPE one-liners need welcome-script paste (not raw send-keys).
    pasteHarnessLaunchCmd(loaded, paneId, type, cmd);

    const verified = verifyHarnessAfterPaste(loaded, registry, paneId, type, cmd, () =>
      pasteHarnessLaunchCmd(loaded, paneId, type, cmd),
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
    const brief = injectAfterLaunch(loaded, registry, label, paneId);
    if (!brief.ok) {
      console.error(`WARN: post-launch brief ${label}: ${brief.detail}`);
    } else {
      console.log(`OK: post-launch brief ${label} ${brief.detail}`);
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

  const state = loadLaunchState(active);
  const skipEmpty = state.conventions?.launch_skips_empty ?? true;
  const wantAll = !opts.targets?.length;
  const want = new Set((opts.targets ?? []).map((t) => t.toLowerCase()));

  const results: LaunchResult[] = [];

  const basePanes = listWindowPaneIds(session, layout.base.window);

  if (want.has("manager-b") || want.has("master-b") || want.has("co-manager")) {
    console.warn("manager-b removed — use a worker slot or seatmesh --profile .sm agent room say -r managers for coordination");
  }

  // Manager stays a terminal on session up / start (welcome + whoami/switch).
  // Explicit only: `seatmesh launch manager` or `agent switch here …`.
  if (want.has("manager") || want.has("master")) {
    const pane = meshManagerPane(session, layout.base.window) ?? basePanes[0];
    if (pane && state.manager) {
      const cmd = launchCmdForSeat(active, "manager", state.manager.type, state);
      results.push(
        tryLaunchPane(active, pane, "manager", cmd, skipEmpty, state.manager.type),
      );
    }
  }

  const meshForCoord = loadMeshAgentsForProfile(loaded);
  const extraCols = baseColumnIds(layout).filter(
    (id) =>
      id !== primaryManagerColumn(layout) && id !== primarySecretaryColumn(layout),
  );
  for (const id of extraCols) {
    const aliases = expandColumnAlias(id);
    if (!(wantAll || aliases.some((a) => want.has(a)))) continue;
    const pane = coordPaneForRole(session, layout.base.window, id);
    if (!pane) continue;
    const profileCli = cliForBaseColumn(loaded, id);
    const harnessType = profileCli === "cursor-agent" ? "agent" : profileCli;
    const cmd = launchCmdForSeat(loaded, id, harnessType, state);
    results.push(tryLaunchPane(loaded, pane, id, cmd, skipEmpty, harnessType));
  }

  if (wantAll || want.has("secretary")) {
    const pane = meshSecretaryPane(session, layout.base.window) ?? basePanes[1];
    if (pane) {
      const secType =
        cliForBaseColumn(loaded, "secretary") ??
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
        const cmd = launchCmdForSeat(loaded, "secretary", harnessType, state);
        results.push(tryLaunchPane(loaded, pane, "secretary", cmd, skipEmpty, harnessType));
      }
    }
  }

  const miniMax = loaded.profile.session.miniMax;
  const miniCli =
    state.conventions?.mini_default_cli ??
    state.conventions?.secretary_default_cli ??
    "opencode";
  const mesh = loadMeshAgentsForProfile(loaded);
  const wantMinis =
    wantAll || want.has("minis") || want.has("mini") || [...want].some((t) => t.startsWith("mini-"));
  if (wantMinis) {
    for (let n = 1; n <= miniMax; n++) {
      const key = `mini-${n}`;
      if (!wantAll && !want.has("minis") && !want.has(key) && !want.has(String(n))) continue;
      const pane = resolveMiniPaneId(session, layout.minis.window, n);
      if (!pane) continue;
      const saved = mesh ? seatAgentEntry(loaded, key, state, mesh) : null;
      const harnessType = resolveMiniHarnessType(saved?.type, miniCli);
      const cmd = launchCmdForSeat(loaded, key, harnessType, state);
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
    const cmd = resolveLaunchCmd(entry, loaded.workspace, loaded);
    results.push(tryLaunchPane(loaded, pane, `slot-${slot}`, cmd, skipEmpty, entry.type));
  }

  if (results.some((r) => r.status === "launched")) {
    try {
      saveMeshSession(active, registryForProfile(active));
    } catch (e) {
      console.error(`WARN: mesh-agents persist after launch: ${(e as Error).message}`);
    }
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

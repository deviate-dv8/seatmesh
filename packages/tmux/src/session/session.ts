import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core";
import { managerStack } from "./base-layout.js";
import { applyMeshSessionBorders } from "./borders.js";
import { labelMeshSession } from "./labels.js";
import { ensureMeshInbox } from "../comms/inbox-bridge.js";
import { launchSession } from "../agents/launch.js";
import { ensureMeshSessionEnv } from "./session-env.js";
import { inboxHealth, meshInboxPort, meshInboxStatusLine } from "../comms/inbox-bridge.js";
import { tmux, tmuxHasSession } from "../lib/tmux-run.js";
import { assertRelayoutSafe } from "./layout-guard.js";
import {
  applyMinisLeadsFromProfile,
  layoutMinisFromProfile,
  layoutWorkers3x2,
  listWindowPaneIds,
} from "./window-panes.js";
import { ensureSeatFiles } from "../seats/seat-init.js";
import { ensureBaseLayout } from "./base-layout.js";
import {
  logCoordSyncResults,
  syncCoordClisFromProfile,
} from "../agents/coord-cli-sync.js";
import {
  activeSessionWindows,
  ensureSessionWindow,
  layoutWindowFlags,
} from "./session-windows.js";

function tmuxBatch(args: string[][]): void {
  for (const a of args) {
    const r = tmux(a);
    if (!r.ok) {
      throw new Error(`tmux ${a.join(" ")} failed: ${r.err || r.out}`);
    }
  }
}

/** Create seatmesh session: base always; nvim/workers/minis optional on cold start. */
export function sessionUp(loaded: LoadedProfile): void {
  const session = loaded.sessionName;
  const wd = loaded.workspace;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  if (tmuxHasSession(session)) {
    throw new Error(`session '${session}' already exists — ./sm.sh session attach`);
  }

  const flags = layoutWindowFlags(loaded);
  const nvim = layout.nvim.window;
  const base = layout.base.window;
  const workers = layout.workers.window;
  const minis = layout.minis.window;

  if (flags.nvim) {
    tmuxBatch([
      ["new-session", "-d", "-s", session, "-n", nvim, "-c", wd],
      ["new-window", "-t", session, "-n", base, "-c", wd],
    ]);
  } else {
    tmuxBatch([["new-session", "-d", "-s", session, "-n", base, "-c", wd]]);
  }

  if (flags.workers) {
    ensureSessionWindow(session, workers, wd);
    layoutWorkers3x2(session, workers, wd);
  }

  if (flags.minis) {
    ensureSessionWindow(session, minis, wd);
    layoutMinisFromProfile(session, minis, wd, layout.minis);
  }

  ensureSeatFiles(loaded);
  ensureMeshSessionEnv(session, {
    workspaceId: loaded.workspaceId,
    sessionName: loaded.sessionName,
  });
  ensureBaseLayout(loaded, session);
  labelMeshSession(loaded, session);

  if (flags.minis) {
    applyMinisLeadsFromProfile(session, minis, layout.minis);
  }

  applyMeshSessionBorders(session, activeSessionWindows(loaded, session));

  if (flags.nvim) {
    tmux(["send-keys", "-t", `${session}:${nvim}`, "nvim", "Enter"]);
  }

  if (process.env.MESH_SKIP_LAUNCH !== "1") {
    launchSession(loaded);
  }

  ensureMeshInbox(loaded, { quiet: true });
}

export function sessionAttach(loaded: LoadedProfile): void {
  const session = loaded.sessionName;
  if (!tmuxHasSession(session)) {
    sessionUp(loaded);
  } else {
    ensureSeatFiles(loaded);
    ensureMeshInbox(loaded, { quiet: true });
    logCoordSyncResults(syncCoordClisFromProfile(loaded, { trigger: "attach" }));
  }

  if (process.env.TMUX) {
    const cur = tmux(["display-message", "-p", "#{session_name}"]).out;
    if (cur === session) {
      return;
    }
    tmux(["switch-client", "-t", session]);
    return;
  }

  const r = spawnSync("tmux", ["attach-session", "-t", session], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

export interface RelayoutOptions {
  /** Skip minis lead swap (grid only). Default: apply profile `layout.minis.leads`. */
  skipMinisLeads?: boolean;
  /** Kill active panes when shrinking grid (default: refuse). */
  force?: boolean;
  /** Persist layout to mesh-agents.json after relayout. Default: true. */
  save?: boolean;
}

/** Ensure worker/mini windows exist, fix geometry, relabel, optionally save profile. */
export function relayoutMeshSession(
  loaded: LoadedProfile,
  opts: RelayoutOptions = {},
): void {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' does not exist — ./sm.sh session up`);
  }

  assertRelayoutSafe(loaded, opts.force ?? false);

  const wd = loaded.workspace;
  ensureSessionWindow(session, layout.workers.window, wd);
  ensureSessionWindow(session, layout.minis.window, wd);

  layoutWorkers3x2(session, layout.workers.window, wd);
  layoutMinisFromProfile(session, layout.minis.window, wd, layout.minis);
  ensureBaseLayout(loaded, session);
  labelMeshSession(loaded, session);
  if (!opts.skipMinisLeads) {
    applyMinisLeadsFromProfile(session, layout.minis.window, layout.minis);
  }
  applyMeshSessionBorders(session, activeSessionWindows(loaded, session));
}

export function sessionStatus(loaded: LoadedProfile): void {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  console.log(`profile=${loaded.profile.name}`);
  console.log(`session=${session}`);
  console.log(`exists=${tmuxHasSession(session)}`);
  console.log(`workspace=${loaded.workspace}`);
  console.log(meshInboxStatusLine(loaded, inboxHealth(meshInboxPort(loaded))));
  if (!tmuxHasSession(session) || !layout) return;

  const flags = layoutWindowFlags(loaded);
  console.log(
    `layout_nvim=${flags.nvim} manager_stack=${managerStack(loaded).join("+")} workers=${flags.workers} minis=${flags.minis}`,
  );

  console.log("--- panes ---");
  for (const win of activeSessionWindows(loaded, session)) {
    for (const paneId of listWindowPaneIds(session, win)) {
      const role = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_role}"]).out;
      const slot = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_slot}"]).out;
      const ports = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_ports}"]).out;
      console.log(`${win}\t${paneId}\t${role}\t${slot}\t${ports}`);
    }
  }
}

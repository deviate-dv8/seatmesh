import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { managerPaneWelcomeShell, parseGridSpec, type LoadedProfile } from "@seat-mesh/core";
import { managerStack, realignBaseLayout } from "./base-layout.js";
import { applyMeshSessionBorders } from "./borders.js";
import { labelMeshSession } from "./labels.js";
import { ensureMeshInbox, stopMeshInbox } from "../comms/inbox-bridge.js";
import { launchSession } from "../agents/launch.js";
import { ensureMeshSessionEnv, installSessionSaveHooks, spawnDetachedSessionSync } from "./session-env.js";
import { ensureLogsWindow } from "./logs-window.js";
import { pasteWelcomeScript } from "./welcome-paste.js";
import { saveMeshSession } from "./save-session.js";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { inboxHealth, meshInboxPort, meshInboxStatusLine } from "../comms/inbox-bridge.js";
import { tmux, tmuxHasSession } from "../lib/tmux-run.js";
import { meshManagerPane } from "../lib/pane-meta.js";
import { assertRelayoutSafe } from "./layout-guard.js";
import {
  applyMinisLeadsFromProfile,
  layoutMinisFromProfile,
  layoutWorkersFromProfile,
  listWindowPaneIds,
  realignEqualGrid,
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

/**
 * Fresh manager = plain terminal with whoami/switch hints (early-adopter onboarding).
 * Does not launch an agent CLI — operator switches when ready.
 */
export function paintManagerWelcome(loaded: LoadedProfile, session: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;
  const pane =
    meshManagerPane(session, layout.base.window) ??
    tmux(["list-panes", "-t", `${session}:${layout.base.window}`, "-F", "#{pane_id}"]).out
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.startsWith("%"));
  if (!pane) return;
  // File-based paste — never raw base64|bash (zsh/tmux truncate → garbled echo on manager).
  pasteWelcomeScript(loaded, pane, managerPaneWelcomeShell(), {
    tag: "manager",
    welcomeOpt: "mesh_manager_welcome",
    status: "terminal · run whoami / switch here",
  });
}

/** Create seatmesh session: base always; nvim/workers/minis optional on cold start. */
export function sessionUp(loaded: LoadedProfile): void {
  const session = loaded.sessionName;
  const wd = loaded.workspace;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  if (tmuxHasSession(session)) {
    throw new Error(
      `session '${session}' already exists — npx seatmesh start  (or: session attach | session down)`,
    );
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

  // Every shell in this session (interactive, non-interactive, or an agent's tool-exec
  // bash -c) gets a working PATH for node/npm/npx with zero manual export — .bashrc alone
  // can't do this (skipped by non-interactive shells; nvm.sh itself refuses to load when
  // npm_config_prefix is already set, which is common here).
  ensureMeshShellEnv(loaded, session);

  if (flags.workers) {
    ensureSessionWindow(session, workers, wd);
    layoutWorkersFromProfile(session, workers, wd, layout.workers);
  }

  if (flags.minis) {
    ensureSessionWindow(session, minis, wd);
    layoutMinisFromProfile(session, minis, wd, layout.minis);
  }

  ensureLogsWindow(loaded, session);

  ensureSeatFiles(loaded);
  ensureMeshSessionEnv(session, {
    workspaceId: loaded.workspaceId,
    sessionName: loaded.sessionName,
    workspace: loaded.workspace,
    profilePath: loaded.profilePath,
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

  // Manager stays a terminal with onboarding echoes (whoami + switch). Other seats may launch.
  paintManagerWelcome(loaded, session);

  if (process.env.MESH_SKIP_LAUNCH !== "1") {
    launchSession(loaded);
  }

  ensureMeshInbox(loaded, { quiet: true });
  installSessionSaveHooks(session, loaded);
  try {
    saveMeshSession(loaded, createRegistryForProfile(loaded.profile));
  } catch {
    /* non-fatal */
  }
}

/**
 * Tear down mesh session + inbox (early-adopter recovery when up is wedged).
 * Safe if session already gone.
 */
export function sessionDown(
  loaded: LoadedProfile,
  opts: { keepInbox?: boolean } = {},
): { sessionKilled: boolean; inboxStopped: boolean } {
  const session = loaded.sessionName;
  let inboxStopped = false;
  if (!opts.keepInbox) {
    try {
      stopMeshInbox(loaded);
      inboxStopped = true;
    } catch {
      /* already down */
    }
  }
  let sessionKilled = false;
  if (tmuxHasSession(session)) {
    const r = tmux(["kill-session", "-t", session]);
    sessionKilled = r.ok;
    if (!r.ok) {
      throw new Error(`session down failed: ${r.err || r.out || "tmux kill-session"}`);
    }
  }
  return { sessionKilled, inboxStopped };
}

/**
 * Inbox + coord repair + scrape — safe to run detached after attach so the
 * operator is not stuck outside tmux waiting on health/coord sync.
 */
/** BASH_ENV/ENV: node PATH + in-session `seatmesh` → npx from workspace. */
function ensureMeshShellEnv(loaded: LoadedProfile, session: string): void {
  const wd = loaded.workspace;
  const meshShellEnv = path.join(wd, "scripts/mesh-shell-env.sh");
  const pathFix = path.join(wd, "scripts/ensure-node-path.sh");
  const shellEnv = fs.existsSync(meshShellEnv)
    ? meshShellEnv
    : fs.existsSync(pathFix)
      ? pathFix
      : null;
  if (shellEnv) {
    tmux(["set-environment", "-t", session, "-g", "BASH_ENV", shellEnv]);
    tmux(["set-environment", "-t", session, "-g", "ENV", shellEnv]);
  }
}

export function sessionSync(loaded: LoadedProfile): void {
  const session = loaded.sessionName;
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' does not exist — seatmesh session up`);
  }
  ensureSeatFiles(loaded);
  ensureMeshShellEnv(loaded, session);
  ensureMeshSessionEnv(session, {
    workspaceId: loaded.workspaceId,
    sessionName: loaded.sessionName,
    workspace: loaded.workspace,
    profilePath: loaded.profilePath,
  });
  ensureLogsWindow(loaded, session);
  installSessionSaveHooks(session, loaded);
  ensureMeshInbox(loaded, { quiet: true });
  applyMeshSessionBorders(session, activeSessionWindows(loaded, session));
  logCoordSyncResults(syncCoordClisFromProfile(loaded, { trigger: "attach" }));
  try {
    saveMeshSession(loaded, createRegistryForProfile(loaded.profile));
  } catch {
    /* non-fatal */
  }
}

export function sessionAttach(loaded: LoadedProfile): void {
  const session = loaded.sessionName;
  if (!tmuxHasSession(session)) {
    sessionUp(loaded);
  } else {
    // Ultra-lazy (tmux-zsign style): do NOT touch inbox/coord/env before attach.
    // bin/seatmesh bash short-circuit is even faster; this is the Node fallback.
    if (process.env.SEATMESH_ATTACH_SYNC === "1") {
      sessionSync(loaded);
    } else {
      spawnDetachedSessionSync(loaded);
    }
  }

  if (process.env.SEATMESH_ATTACH_DRY === "1") {
    console.log(`OK: attach dry-run session=${session} (would tmux attach now)`);
    return;
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
    throw new Error(`session '${session}' does not exist — seatmesh --profile .sm session up`);
  }

  assertRelayoutSafe(loaded, opts.force ?? false);

  const wd = loaded.workspace;
  ensureSessionWindow(session, layout.workers.window, wd);
  ensureSessionWindow(session, layout.minis.window, wd);

  layoutWorkersFromProfile(session, layout.workers.window, wd, layout.workers);
  layoutMinisFromProfile(session, layout.minis.window, wd, layout.minis);
  ensureLogsWindow(loaded, session);
  ensureBaseLayout(loaded, session);
  labelMeshSession(loaded, session);
  if (!opts.skipMinisLeads) {
    applyMinisLeadsFromProfile(session, layout.minis.window, layout.minis);
  }
  applyMeshSessionBorders(session, activeSessionWindows(loaded, session));
}

export type RealignPart = boolean | "skip";

/** Resize-only: base ratio + worker/mini equal grids. No create/kill. */
export function realignAllLayouts(loaded: LoadedProfile): {
  base: RealignPart;
  workers: RealignPart;
  minis: RealignPart;
} {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");
  if (!tmuxHasSession(session)) {
    throw new Error(`session '${session}' does not exist — seatmesh --profile .sm session up`);
  }

  const base = realignBaseLayout(loaded, session);
  let workers: RealignPart = "skip";
  if (layout.workers.enabled) {
    const { cols, rows } = parseGridSpec(layout.workers.grid);
    workers = realignEqualGrid(session, layout.workers.window, cols, rows);
  }
  let minis: RealignPart = "skip";
  if (layout.minis.enabled) {
    const { cols, rows } = parseGridSpec(layout.minis.grid);
    minis = realignEqualGrid(session, layout.minis.window, cols, rows);
  }
  return { base, workers, minis };
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
    `layout_nvim=${flags.nvim} manager_stack=${managerStack(loaded).join("+")} workers=${flags.workers} minis=${flags.minis} logs=${flags.logs}`,
  );

  console.log("--- panes ---");
  for (const win of activeSessionWindows(loaded, session)) {
    for (const paneId of listWindowPaneIds(session, win)) {
      const role = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_role}"]).out;
      const slot = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_slot}"]).out;
      const ports = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_ports}"]).out;
      console.log(`${win}\t${paneId}\t${role || "plain"}\t${slot || "-"}\t${ports || "-"}`);
    }
  }
}

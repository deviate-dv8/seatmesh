/**
 * Window 9 (default): seatmesh logs —
 *   left  | plain terminal (welcome echo + operator shell)
 *   right | inbox-log (top) + peer-queue (bot)  — current tails
 */
import path from "node:path";
import {
  logsLayoutEnabled,
  logsPaneWelcomeShell,
  meshRuntimePaths,
  type LoadedProfile,
} from "@seat-mesh/core";
import { loadMeshAgentsForProfile } from "../agents/agents-state.js";
import { tmux } from "../lib/tmux-run.js";
import { applyMeshBorderFormat, fitBannerLine, paneDisplayWidth } from "./borders.js";
import { listWindowPaneIds } from "./window-panes.js";
import { ensureSessionWindow, sessionWindowExists } from "./session-windows.js";
import { pasteWelcomeScript } from "./welcome-paste.js";

/** left operator shell + right stacked tails */
const LOGS_LAYOUT_VER = "3";

function paneOpt(paneId: string, key: string): string {
  return tmux(["display-message", "-t", paneId, "-p", `#{@${key}}`]).out.trim();
}

function setPaneOpt(paneId: string, key: string, value: string): void {
  tmux(["set-option", "-p", "-t", paneId, `@${key}`, value]);
}

function windowIndex(session: string, window: string): number | null {
  const out = tmux([
    "list-windows",
    "-t",
    session,
    "-F",
    "#{window_name}\t#{window_index}",
  ]).out;
  for (const line of out.split("\n")) {
    const [name, idx] = line.split("\t");
    if (name === window) {
      const n = Number(idx);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Fixed banner for a logs pane — daemon border-paint does not cover these. */
export function stampLogPaneBanner(paneId: string, name: string, status: string): void {
  setPaneOpt(paneId, "mesh_role", "logs");
  setPaneOpt(paneId, "mesh_slot", name);
  setPaneOpt(paneId, "mesh_name", name);
  setPaneOpt(paneId, "mesh_title", name);
  setPaneOpt(paneId, "mesh_ports", "logs");
  setPaneOpt(paneId, "mesh_status", status);
  setPaneOpt(paneId, "mesh_logs_role", name);
  tmux(["select-pane", "-t", paneId, "-T", name]);
  const banner = fitBannerLine(paneDisplayWidth(paneId), {
    name,
    tasks: "",
    inbox: "",
    status,
  });
  setPaneOpt(paneId, "mesh_banner", banner);
}

function startLogTail(paneId: string, cmd: string): void {
  if (paneOpt(paneId, "mesh_logs") === "1") return;
  setPaneOpt(paneId, "mesh_logs", "1");
  tmux(["send-keys", "-t", paneId, "-l", cmd]);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

function findByRole(panes: string[], role: string): string | undefined {
  return panes.find((p) => paneOpt(p, "mesh_logs_role") === role);
}

/** Collapse to one pane, then build left | (top/bot). */
function rebuildLogsPanes(session: string, window: string, wd: string): string[] {
  let panes = listWindowPaneIds(session, window);
  while (panes.length > 1) {
    const victim = panes[panes.length - 1]!;
    tmux(["kill-pane", "-t", victim]);
    panes = listWindowPaneIds(session, window);
  }
  if (panes.length === 0) return [];

  // Vertical split → left | right (tmux -h)
  tmux(["split-window", "-h", "-t", panes[0]!, "-c", wd]);
  panes = listWindowPaneIds(session, window);
  const right = panes[1] ?? panes[0];
  if (!right) return panes;

  // Horizontal split on right → top / bot (tmux -v)
  tmux(["split-window", "-v", "-t", right, "-c", wd]);
  panes = listWindowPaneIds(session, window);

  // main-vertical: left column + stacked right (stable geometry)
  tmux(["select-layout", "-t", `${session}:${window}`, "main-vertical"]);
  return listWindowPaneIds(session, window);
}

/**
 * Ensure logs window exists at profile index (default 9):
 * left = operator shell (welcome echo), right = inbox-log + peer-queue tails.
 */
export function ensureLogsWindow(loaded: LoadedProfile, session?: string): void {
  const sess = session ?? loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout?.logs) return;
  const mesh = loadMeshAgentsForProfile(loaded);
  if (!logsLayoutEnabled(layout, mesh?.layout ?? null)) return;

  const name = layout.logs.window || "logs";
  const wantIdx = layout.logs.index ?? 9;
  const wd = loaded.workspace;
  const paths = meshRuntimePaths(loaded);
  const inboxLog = paths.meshInboxLog;
  const peerLog = path.join(paths.daemonDir, "PEER.jsonl");

  if (!sessionWindowExists(sess, name)) {
    const r = tmux(["new-window", "-t", `${sess}:${wantIdx}`, "-n", name, "-c", wd]);
    if (!r.ok) {
      ensureSessionWindow(sess, name, wd);
    }
  }

  const curIdx = windowIndex(sess, name);
  if (curIdx != null && curIdx !== wantIdx) {
    const taken = tmux([
      "list-windows",
      "-t",
      sess,
      "-F",
      "#{window_index}\t#{window_name}",
    ]).out
      .split("\n")
      .map((l) => l.split("\t"))
      .find(([idx, win]) => Number(idx) === wantIdx && win !== name);
    if (!taken) {
      tmux(["move-window", "-s", `${sess}:${name}`, "-t", `${sess}:${wantIdx}`]);
    }
  }

  let panes = listWindowPaneIds(sess, name);
  if (panes.length === 0) return;

  const layoutOk =
    panes.length >= 3 &&
    panes.some((p) => paneOpt(p, "mesh_logs_layout") === LOGS_LAYOUT_VER) &&
    Boolean(findByRole(panes, "run")) &&
    Boolean(findByRole(panes, "inbox-log")) &&
    Boolean(findByRole(panes, "peer-queue"));

  if (!layoutOk) {
    panes = rebuildLogsPanes(sess, name, wd);
    for (const p of panes) {
      setPaneOpt(p, "mesh_logs", "0");
      setPaneOpt(p, "mesh_logs_layout", LOGS_LAYOUT_VER);
      setPaneOpt(p, "mesh_logs_welcome", "0");
    }
  }

  panes = listWindowPaneIds(sess, name);
  if (panes.length < 3) return;

  applyMeshBorderFormat(sess, name);

  // After main-vertical: typically [left, right-top, right-bot] in list order.
  let left = findByRole(panes, "run");
  let top = findByRole(panes, "inbox-log");
  let bot = findByRole(panes, "peer-queue");
  if (!left || !top || !bot) {
    left = panes[0];
    top = panes[1];
    bot = panes[2];
  }

  if (left) {
    stampLogPaneBanner(left, "run", "operator shell · seatmesh help");
    setPaneOpt(left, "mesh_logs_layout", LOGS_LAYOUT_VER);
    pasteWelcomeScript(loaded, left, logsPaneWelcomeShell(), {
      tag: "logs-run",
      welcomeOpt: "mesh_logs_welcome",
      status: "operator shell · seatmesh help",
    });
  }
  if (top) {
    stampLogPaneBanner(top, "inbox-log", "tail · mesh-inbox.log");
    setPaneOpt(top, "mesh_logs_layout", LOGS_LAYOUT_VER);
    startLogTail(top, `exec tail -n 100 -F ${shellQuote(inboxLog)}`);
  }
  if (bot && bot !== top) {
    stampLogPaneBanner(bot, "peer-queue", "tail · PEER.jsonl");
    setPaneOpt(bot, "mesh_logs_layout", LOGS_LAYOUT_VER);
    startLogTail(bot, `exec tail -n 60 -F ${shellQuote(peerLog)}`);
  }
}

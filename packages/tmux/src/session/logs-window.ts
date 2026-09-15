/**
 * Window 9 (default): seatmesh logs — split tails for inbox + peer queues.
 * Plain terminals still get a fixed mesh banner (name | status).
 */
import path from "node:path";
import {
  logsLayoutEnabled,
  meshRuntimePaths,
  type LoadedProfile,
} from "@seat-mesh/core";
import { loadMeshAgentsForProfile } from "../agents/agents-state.js";
import { tmux } from "../lib/tmux-run.js";
import { applyMeshBorderFormat, fitBannerLine, paneDisplayWidth } from "./borders.js";
import { listWindowPaneIds } from "./window-panes.js";
import { ensureSessionWindow, sessionWindowExists } from "./session-windows.js";

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

/**
 * Ensure logs window exists at profile index (default 9), split, stamp banners,
 * and tail mesh-inbox.log + PEER.jsonl when panes are fresh.
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
  if (panes.length < 2) {
    tmux(["split-window", "-t", `${sess}:${name}`, "-v", "-c", wd]);
    panes = listWindowPaneIds(sess, name);
  }

  applyMeshBorderFormat(sess, name);

  const top = panes[0];
  const bot = panes[1] ?? panes[0];
  if (top) {
    stampLogPaneBanner(top, "inbox-log", "tail · mesh-inbox.log");
    startLogTail(top, `exec tail -n 100 -F ${shellQuote(inboxLog)}`);
  }
  if (bot && bot !== top) {
    stampLogPaneBanner(bot, "peer-queue", "tail · PEER.jsonl");
    startLogTail(bot, `exec tail -n 60 -F ${shellQuote(peerLog)}`);
  }
}

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type { PaneSnapshot } from "@seat-mesh/core";

function tmux(args: string[]): string | null {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trimEnd();
}

function treePids(rootPid: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    out.push(pid);
    const r = spawnSync("ps", ["--ppid", pid, "-o", "pid=", "--no-headers"], {
      encoding: "utf8",
    });
    for (const line of (r.stdout ?? "").split("\n")) {
      const child = line.trim();
      if (child) walk(child);
    }
  };
  walk(rootPid);
  return out;
}

function cmdlineOf(pid: string): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch {
    return "";
  }
}

export function capturePaneSnapshot(paneId: string): PaneSnapshot | null {
  const pid = tmux(["display-message", "-t", paneId, "-p", "#{pane_pid}"]);
  if (!pid) return null;

  const cmdlines = treePids(pid)
    .map(cmdlineOf)
    .filter((c) => c.length > 0);

  const opts: Record<string, string> = {};
  opts.processCmdlines = cmdlines.join("\0");

  for (const key of [
    "mesh_role",
    "mesh_slot",
    "mesh_mini",
    "mesh_ports",
    "mesh_title",
    "mesh_name",
    "mesh_tasks",
    "mesh_inbox",
    "mesh_checkbacks",
    "mesh_status",
    "mesh_oc_session",
  ]) {
    const v = tmux(["display-message", "-t", paneId, "-p", `#{@${key}}`]);
    if (v) opts[key] = v;
  }

  const capture =
    tmux(["capture-pane", "-t", paneId, "-p", "-S", "-80"]) ?? "";
  const captureAnsi =
    tmux(["capture-pane", "-e", "-t", paneId, "-p", "-S", "-80"]) ?? "";

  return {
    paneId,
    windowName: tmux(["display-message", "-t", paneId, "-p", "#{window_name}"]) ?? "",
    cwd: tmux(["display-message", "-t", paneId, "-p", "#{pane_current_path}"]) ?? "",
    currentCommand:
      tmux(["display-message", "-t", paneId, "-p", "#{pane_current_command}"]) ?? "",
    captureTail: capture,
    captureTailAnsi: captureAnsi || undefined,
    options: opts,
  };
}

export function listSessionPanes(session = "dev"): string[] {
  const out = tmux(["list-panes", "-s", "-t", session, "-F", "#{pane_id}"]);
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}

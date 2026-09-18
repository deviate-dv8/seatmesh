/**
 * Detect whether a tmux pane still has a live agent under a shell wrapper.
 * Welcome / cold-start scripts keep `#{pane_current_command}` as bash while
 * opencode-cpe.sh (or agent/claude) runs as a child — auto-revive must not
 * treat that as an empty shell.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const AGENT_CMDLINE_RE =
  /\b(opencode-cpe\.sh|opencode|claude|kiro-cli|kiro|cursor-agent|\bagent\b)\b/i;

function tmuxFmt(paneId: string, fmt: string): string {
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", fmt], {
    encoding: "utf8",
  });
  return (r.stdout ?? "").trim();
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

export function isPlainShellCommand(cmd: string): boolean {
  return /^(zsh|bash|sh|fish|dash)$/i.test(cmd.trim()) || !cmd.trim();
}

/** True when any process under pane_pid looks like a mesh agent CLI. */
export function paneHasAgentProcessTree(paneId: string): boolean {
  const pid = tmuxFmt(paneId, "#{pane_pid}");
  if (!pid || !/^\d+$/.test(pid)) return false;
  for (const p of treePids(pid)) {
    if (AGENT_CMDLINE_RE.test(cmdlineOf(p))) return true;
  }
  return false;
}

/**
 * Pane is a real idle shell (safe to auto-revive / treat as empty).
 * False when top-level is a CLI, or when bash wraps a live agent child.
 */
export function paneIsIdleShell(paneId: string): boolean {
  const cmd = tmuxFmt(paneId, "#{pane_current_command}");
  if (!isPlainShellCommand(cmd)) return false;
  return !paneHasAgentProcessTree(paneId);
}

/** Exported for unit tests — match agent cmdlines without tmux. */
export function cmdlineLooksLikeAgent(cmdline: string): boolean {
  return AGENT_CMDLINE_RE.test(cmdline);
}

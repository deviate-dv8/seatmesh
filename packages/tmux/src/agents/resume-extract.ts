import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Detection, ProviderRegistry } from "@seat-mesh/core";
import { extractUuid } from "@seat-mesh/providers";
import { capturePaneSnapshot } from "../lib/snapshot.js";

function tmuxPanePid(paneId: string): string | null {
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{pane_pid}"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const pid = (r.stdout ?? "").trim();
  return pid || null;
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

function extractAgentIdFromLogs(panePid: string): string | undefined {
  const logRoot = "/tmp";
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(logRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("cursor-agent-logs-"))
      .map((e) => path.join(logRoot, e.name));
  } catch {
    return undefined;
  }
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.includes(`-${panePid}-`) && f.endsWith(".log"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(dir, file), "utf8");
        const m = text.match(/conversationId":"([0-9a-fA-F-]{36})"/g);
        const last = m?.at(-1);
        if (last) {
          const id = last.match(/([0-9a-fA-F-]{36})/)?.[1];
          if (id) return id;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return undefined;
}

function extractKiroIdFromLocks(tree: string[]): string | undefined {
  const lockDir = path.join(os.homedir(), ".kiro/sessions/cli");
  if (!fs.existsSync(lockDir)) return undefined;
  const treeSet = new Set(tree);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(lockDir).filter((f) => f.endsWith(".lock"));
  } catch {
    return undefined;
  }
  for (const file of entries) {
    const lockPath = path.join(lockDir, file);
    try {
      const raw = fs.readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as { pid?: number };
      if (parsed.pid != null && treeSet.has(String(parsed.pid))) {
        return file.replace(/\.lock$/, "");
      }
    } catch {
      continue;
    }
  }
  for (const pid of tree) {
    const cmd = cmdlineOf(pid);
    const id = extractUuid(cmd, ["--resume-id", "--resume"]);
    if (id) return id;
  }
  return undefined;
}

function extractClaudeIdFromFds(tree: string[]): string | undefined {
  for (const pid of tree) {
    const cmd = cmdlineOf(pid);
    let id = extractUuid(cmd, ["--resume", "--session-id"]);
    if (id) return id;
    try {
      const fdDir = `/proc/${pid}/fd`;
      const links = fs.readdirSync(fdDir);
      for (const link of links) {
        try {
          const target = fs.readlinkSync(path.join(fdDir, link));
          const m = target.match(/\/tmp\/claude-[^/]+\/[^/]+\/([0-9a-fA-F-]{36})\//);
          if (m?.[1]) return m[1];
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Detect resume id from live pane (provider detect + harness-style fallbacks). */
export function extractResumeIdAuto(
  paneId: string,
  registry: ProviderRegistry,
): string | null {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return null;

  const prov = registry.detect(snap);
  let det: Detection | null = null;
  if (prov) det = prov.detect(snap);
  if (det?.resumeId?.trim()) return det.resumeId.trim();

  const panePid = tmuxPanePid(paneId);
  if (!panePid) return null;
  const tree = treePids(panePid);
  const providerId = det?.providerId ?? prov?.id;

  if (providerId === "cursor-agent" || providerId === "agent") {
    for (const pid of tree) {
      const id = extractUuid(cmdlineOf(pid), ["--resume"]);
      if (id) return id;
    }
    const fromLog = extractAgentIdFromLogs(panePid);
    if (fromLog) return fromLog;
  }

  if (providerId === "kiro") {
    const id = extractKiroIdFromLocks(tree);
    if (id) return id;
  }

  if (providerId === "claude") {
    const id = extractClaudeIdFromFds(tree);
    if (id) return id;
  }

  if (providerId === "opencode") {
    return null;
  }

  return null;
}

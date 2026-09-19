/**
 * Health-rescue wedge diagnostics (TODO 7.6). Today, when a daemon child wedges
 * badly enough to miss 3 consecutive /health probes, mesh-inbox-watcher.ts's only
 * lever is SIGKILL-and-respawn — real evidence of what actually broke (found while
 * investigating TODO 7.7: 735 wedge events on pia alone, Sep 15-17) is thrown away
 * with the killed process. This captures a small, best-effort snapshot right before
 * the kill — never blocks or fails the rescue itself.
 *
 * Deliberately a single overwritten file per mesh (`last-wedge.json`), not one file
 * per event — the whole point of investigating 7.7 was discovering this can fire
 * hundreds of times; an unbounded directory of wedge files would just be a second,
 * smaller version of the same "opacity" problem this is meant to fix.
 */
import fs from "node:fs";
import path from "node:path";

export interface WedgeProcState {
  state?: string;
  vmRssKb?: number;
  threads?: number;
}

export interface WedgeSnapshot {
  at: string;
  session: string;
  port: number;
  pid?: number;
  healthMisses: number;
  healthMissThreshold: number;
  healthTimeoutMs: number;
  /** null when /proc/<pid>/status wasn't readable (non-Linux, pid already gone, etc). */
  procState: WedgeProcState | null;
  /** Last N lines of this mesh's own daemon log, so "what was it doing" survives the kill. */
  recentLogTail: string[];
}

/** Best-effort — never throws. Linux-only (/proc); returns null elsewhere. */
export function readProcState(pid: number | undefined): WedgeProcState | null {
  if (!pid) return null;
  try {
    const raw = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const field = (key: string): string | undefined =>
      raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
    const state = field("State");
    const vmRssRaw = field("VmRSS")?.replace(/\s*kB$/, "");
    const threadsRaw = field("Threads");
    const out: WedgeProcState = {};
    if (state) out.state = state;
    if (vmRssRaw) {
      const n = Number.parseInt(vmRssRaw, 10);
      if (Number.isFinite(n)) out.vmRssKb = n;
    }
    if (threadsRaw) {
      const n = Number.parseInt(threadsRaw, 10);
      if (Number.isFinite(n)) out.threads = n;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Best-effort — never throws. Empty array when the file is missing/unreadable. */
export function tailLogFile(file: string, lines: number): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(-lines);
  } catch {
    return [];
  }
}

/**
 * Writes `<stateDir>/last-wedge.json`. Swallows every error internally — a
 * diagnostics failure must never prevent or delay the actual SIGKILL rescue.
 */
export function writeWedgeSnapshot(
  stateDir: string,
  logPath: string,
  opts: {
    session: string;
    port: number;
    pid?: number;
    healthMisses: number;
    healthMissThreshold: number;
    healthTimeoutMs: number;
  },
): void {
  try {
    const snapshot: WedgeSnapshot = {
      at: new Date().toISOString(),
      session: opts.session,
      port: opts.port,
      pid: opts.pid,
      healthMisses: opts.healthMisses,
      healthMissThreshold: opts.healthMissThreshold,
      healthTimeoutMs: opts.healthTimeoutMs,
      procState: readProcState(opts.pid),
      recentLogTail: tailLogFile(logPath, 40),
    };
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "last-wedge.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  } catch {
    /* diagnostics are best-effort — never break the rescue path */
  }
}

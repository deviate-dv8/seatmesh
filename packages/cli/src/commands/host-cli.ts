/**
 * `seatmesh host up|down|status` — opt-in single host-level supervisor (Phase 1 of
 * the single-daemon migration, see NOW.md "Direction"). One process manages a
 * mesh-inbox-watcher per mesh registered in `~/.config/seatmesh/sessions.json`,
 * instead of each mesh spawning its own supervisor+server pair.
 *
 * Does not touch `ensureMeshInbox` — meshes still spawn their own per-mesh
 * supervisor by default unless the operator runs `host up` explicitly.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { globalConfigDir, resolveDaemonScript } from "@seat-mesh/core";

interface HostMeta {
  hostSupervisorPid: number;
  startedAt: string;
  rescanMs: number;
  sessions: Array<{ profilePath: string; session: string; port: number; pid?: number }>;
}

function hostStateDir(): string {
  return globalConfigDir();
}
function metaPath(): string {
  return path.join(hostStateDir(), "host-supervisor.json");
}
function stopPath(): string {
  return path.join(hostStateDir(), "host-supervisor.stop");
}
function logPath(): string {
  return path.join(hostStateDir(), "host-supervisor.log");
}

function readMeta(): HostMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(), "utf8")) as HostMeta;
  } catch {
    return null;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  return spawnSync("kill", ["-0", String(pid)], { stdio: "ignore" }).status === 0;
}

function sleepSync(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

export function hostUp(): number {
  const existing = readMeta();
  if (existing && pidAlive(existing.hostSupervisorPid)) {
    console.log(`host-supervisor already running pid=${existing.hostSupervisorPid}`);
    return 0;
  }

  const entryJs = resolveDaemonScript("mesh-inbox-host-supervisor.js");
  if (!fs.existsSync(entryJs)) {
    console.error(`host-supervisor script missing: ${entryJs} — run seatmesh reload`);
    return 1;
  }
  try {
    fs.unlinkSync(stopPath());
  } catch {
    /* ignore */
  }
  fs.mkdirSync(hostStateDir(), { recursive: true });
  const child = spawn("node", [entryJs], { detached: true, stdio: "ignore" });
  child.unref();

  for (let i = 0; i < 40; i++) {
    const meta = readMeta();
    if (meta && pidAlive(meta.hostSupervisorPid)) {
      console.log(`OK: host-supervisor up pid=${meta.hostSupervisorPid} (${meta.sessions.length} mesh(es))`);
      return 0;
    }
    sleepSync(250);
  }
  console.error(`host-supervisor did not come up (see ${logPath()})`);
  return 1;
}

export function hostDown(): number {
  const meta = readMeta();
  if (!meta || !pidAlive(meta.hostSupervisorPid)) {
    console.log("host-supervisor not running");
    return 0;
  }
  fs.mkdirSync(hostStateDir(), { recursive: true });
  fs.writeFileSync(stopPath(), `${new Date().toISOString()} stop\n`, { encoding: "utf8" });
  spawnSync("kill", ["-TERM", String(meta.hostSupervisorPid)], { stdio: "ignore" });

  for (let i = 0; i < 20; i++) {
    if (!pidAlive(meta.hostSupervisorPid)) {
      console.log("OK: host-supervisor stopped");
      return 0;
    }
    sleepSync(250);
  }
  spawnSync("kill", ["-KILL", String(meta.hostSupervisorPid)], { stdio: "ignore" });
  console.log("OK: host-supervisor stopped (force)");
  return 0;
}

export function hostStatus(): number {
  const meta = readMeta();
  if (!meta || !pidAlive(meta.hostSupervisorPid)) {
    console.log("host-supervisor: DOWN");
    return 1;
  }
  console.log(`host-supervisor: UP pid=${meta.hostSupervisorPid} started=${meta.startedAt} rescan=${meta.rescanMs}ms`);
  if (!meta.sessions.length) {
    console.log("  (no meshes registered in ~/.config/seatmesh/sessions.json)");
    return 0;
  }
  for (const s of meta.sessions) {
    console.log(`  ${s.session}  :${s.port}  pid=${s.pid ?? "-"}  ${s.profilePath}`);
  }
  return 0;
}

export function runHostCommand(args: string[]): number {
  const sub = args[0];
  switch (sub) {
    case "up":
      return hostUp();
    case "down":
      return hostDown();
    case "status":
    case undefined:
      return hostStatus();
    default:
      console.error(`unknown: seatmesh host ${sub}`);
      console.error("usage: seatmesh host up|down|status");
      return 2;
  }
}

#!/usr/bin/env node
/**
 * Single host-level supervisor — Phase 1 of the single-daemon migration (see NOW.md
 * "Direction"). One process walks `~/.config/seatmesh/sessions.json` and runs one
 * mesh-inbox-watcher per registered mesh, instead of each mesh spawning its own
 * independent supervisor+server pair (N health-watch loops, N HMR-poll loops on one
 * host). Still one inject-consumer server per mesh (own port, own queues) — this
 * phase only consolidates the *supervisor* layer, not the inject path.
 *
 * Opt-in: `seatmesh host up|down|status`. Does NOT replace the per-mesh supervisor
 * that `ensureMeshInbox` spawns by default — existing meshes are unaffected unless
 * an operator switches them over.
 */
import fs from "node:fs";
import path from "node:path";
import {
  globalConfigDir,
  loadProfile,
  readGlobalRegistry,
  type LoadedProfile,
} from "@seat-mesh/core";
import { createMeshWatcher, type MeshWatcher } from "./mesh-inbox-watcher.js";
import { diffRegistrySessions } from "./host/registry-diff.js";

const RESCAN_MS = Number(process.env.MESH_HOST_SUPERVISOR_RESCAN_MS || 5000);

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

function appendLog(line: string): void {
  fs.mkdirSync(hostStateDir(), { recursive: true });
  fs.appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`, { encoding: "utf8" });
}

function log(msg: string): void {
  appendLog(msg);
  console.error(`mesh-inbox-host-supervisor: ${msg}`);
}

interface HostMeta {
  hostSupervisorPid: number;
  startedAt: string;
  rescanMs: number;
  sessions: Array<{ profilePath: string; session: string; port: number; pid?: number }>;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const watchers = new Map<string, MeshWatcher>();
  let shuttingDown = false;

  try {
    fs.unlinkSync(stopPath());
  } catch {
    /* ignore */
  }

  const writeMeta = () => {
    const meta: HostMeta = {
      hostSupervisorPid: process.pid,
      startedAt,
      rescanMs: RESCAN_MS,
      sessions: [...watchers.values()].map((w) => ({
        profilePath: w.profilePath,
        session: w.session,
        port: w.port,
        pid: w.pid(),
      })),
    };
    fs.mkdirSync(hostStateDir(), { recursive: true });
    fs.writeFileSync(metaPath(), `${JSON.stringify(meta, null, 2)}\n`);
  };

  const startOne = (profilePath: string): void => {
    let loaded: LoadedProfile;
    try {
      loaded = loadProfile(profilePath);
    } catch (e) {
      log(`skip ${profilePath} — loadProfile failed: ${(e as Error).message}`);
      return;
    }
    const watcher = createMeshWatcher(loaded, {
      logPrefix: `[host:${loaded.sessionName}]`,
      onLog: (line) => log(line),
    });
    watchers.set(profilePath, watcher);
  };

  const stopOne = (profilePath: string, why: string): void => {
    const watcher = watchers.get(profilePath);
    if (!watcher) return;
    watcher.stop(why);
    watchers.delete(profilePath);
  };

  const rescan = (): void => {
    if (shuttingDown) return;
    const reg = readGlobalRegistry();
    const registered = reg.sessions.map((s) => s.profilePath);
    const { toStart, toStop } = diffRegistrySessions(watchers.keys(), registered);
    for (const p of toStop) {
      log(`session de-registered — stopping watcher for ${p}`);
      stopOne(p, "de-registered");
    }
    for (const p of toStart) {
      log(`session registered — starting watcher for ${p}`);
      startOne(p);
    }
    if (toStart.length || toStop.length) writeMeta();
  };

  const shutdown = (why: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutdown (${why}) — stopping ${watchers.size} watcher(s)`);
    for (const [profilePath] of watchers) stopOne(profilePath, why);
    try {
      fs.unlinkSync(stopPath());
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 800);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  log(`starting — rescan=${RESCAN_MS}ms registry=${hostStateDir()}`);
  rescan();
  writeMeta();

  setInterval(() => {
    if (shuttingDown) return;
    if (fs.existsSync(stopPath())) {
      shutdown("stop-file");
      return;
    }
    rescan();
    writeMeta();
  }, RESCAN_MS);
}

void main().catch((e) => {
  console.error(`mesh-inbox-host-supervisor fatal: ${(e as Error).message}`);
  process.exit(1);
});

/**
 * Per-mesh watch state machine — spawn/health/HMR/restart for one mesh-inbox-server
 * child. Factored out of mesh-inbox-supervisor.ts (single-profile CLI entry) so
 * mesh-inbox-host-supervisor.ts (single host process, N meshes) can run one of
 * these per registered session without duplicating the logic.
 *
 * Behavior is unchanged from the original per-mesh supervisor — same meta shape,
 * same log prefix, same HMR/health-rescue thresholds — so existing tooling that
 * reads `mesh-inbox.json` (readMeshInboxMeta, `seatmesh inbox`, `/health`) keeps
 * working whichever supervisor started the child.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  meshRuntimePaths,
  resolveDaemonPort,
  resolveDaemonScript,
  type LoadedProfile,
} from "@seat-mesh/core";

export interface MeshWatcherOptions {
  /** Health poll interval while the child is up. */
  healthWatchMs?: number;
  /** Timeout for a single /health probe. */
  healthTimeoutMs?: number;
  /** Consecutive misses before SIGKILL rescue. */
  healthMissThreshold?: number;
  /** How often to stat the server bundle for HMR. */
  hmrPollMs?: number;
  /** Delay before restarting a crashed child. */
  restartDelayMs?: number;
  /** OC-V2 inflight stamp — HMR defers while an atomic is mid-flight. */
  ocV2InflightPath?: string;
  ocV2HmrBlockMs?: number;
  /** Prefix each log line, e.g. `[host:zsign]` — default `[supervisor]`. */
  logPrefix?: string;
  /** Called for every log line (also always appended to the mesh's own log file). */
  onLog?: (line: string) => void;
}

export interface MeshWatcher {
  readonly profilePath: string;
  readonly port: number;
  readonly session: string;
  /** Current child pid, if healthy/spawned. */
  pid(): number | undefined;
  /** SIGTERM the child (then SIGKILL after a grace period) and stop all timers. */
  stop(why: string): void;
}

interface SupervisorMeta {
  supervisorPid: number;
  pid?: number;
  port: number;
  session: string;
  workspaceId?: string;
  watch: true;
  hmr: true;
  serverJs: string;
  childStartedAt?: string;
  restarts: number;
  healthMisses?: number;
  startedAt: string;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function appendLog(logPath: string, line: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, { encoding: "utf8" });
}

function fetchHealth(port: number, timeoutMs = 2000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForHealth(
  port: number,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await fetchHealth(port, 2000);
    if (h?.engine === "@seat-mesh/daemon" && h.ok === true) return h;
    await sleepMs(200);
  }
  return null;
}

function ocV2InflightBlocksHmr(stampPath: string, blockMs: number): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(stampPath, "utf8")) as {
      pid?: number;
      heartbeatAt?: number;
    };
    if (!raw || typeof raw.heartbeatAt !== "number") return false;
    if (Date.now() - raw.heartbeatAt > blockMs) return false;
    if (typeof raw.pid === "number" && raw.pid > 0 && !processAlive(raw.pid)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Start watching one mesh (spawn its mesh-inbox-server, HMR-restart on bundle
 * change, health-rescue on wedge, crash-restart). Mirrors the standalone
 * mesh-inbox-supervisor.ts CLI exactly, parameterized so N of these can run
 * inside one host process.
 */
export function createMeshWatcher(loaded: LoadedProfile, opts: MeshWatcherOptions = {}): MeshWatcher {
  const profile = loaded.profile;
  const workspace = loaded.workspace;
  const port = resolveDaemonPort(loaded.profile, loaded.workspace);
  const restartDelayMs = profile.daemon?.restartDelayMs ?? 1500;
  const hmrPollMs = opts.hmrPollMs ?? profile.daemon?.hmrPollMs ?? 2000;
  const healthWatchMs = opts.healthWatchMs ?? 30_000;
  const healthTimeoutMs = opts.healthTimeoutMs ?? 25_000;
  const healthMissThreshold = opts.healthMissThreshold ?? 3;
  const ocV2InflightPath =
    opts.ocV2InflightPath ??
    process.env.CPE_OC_LIMIT_V2_INFLIGHT ??
    "/tmp/seatmesh-oc-v2-inflight.json";
  const ocV2HmrBlockMs = opts.ocV2HmrBlockMs ?? Number(process.env.OC_V2_HMR_BLOCK_MS || 120_000);
  const logPrefix = opts.logPrefix ?? "[supervisor]";

  const rt = meshRuntimePaths(loaded);
  const stateDir = rt.daemonDir;
  const metaPath = rt.meshInboxMeta;
  const stopPath = rt.meshInboxStop;
  const logPath = rt.meshInboxLog;
  const serverJs = resolveDaemonScript("mesh-inbox-server.js");

  let shuttingDown = false;
  let spawning = false;
  let child: ChildProcess | null = null;
  let childStartedAt = 0;
  let restarts = 0;
  let healthMisses = 0;
  let lastBundleMtime = fs.existsSync(serverJs) ? fs.statSync(serverJs).mtimeMs : 0;
  let logFd: number | null = null;
  const startedAt = new Date().toISOString();
  const timers: NodeJS.Timeout[] = [];

  const log = (msg: string) => {
    appendLog(logPath, `${logPrefix} ${msg}`);
    const line = `mesh-inbox-supervisor[${loaded.sessionName}]: ${msg}`;
    if (opts.onLog) opts.onLog(line);
    else console.error(line);
  };

  const writeMeta = (childPid?: number) => {
    const meta: SupervisorMeta = {
      supervisorPid: process.pid,
      pid: childPid,
      port,
      session: loaded.sessionName,
      workspaceId: loaded.workspaceId,
      watch: true,
      hmr: true,
      serverJs,
      childStartedAt: childPid ? new Date(childStartedAt).toISOString() : undefined,
      restarts,
      healthMisses,
      startedAt,
    };
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  };

  const stopChild = (signal: NodeJS.Signals = "SIGTERM") => {
    if (!child?.pid) return;
    try {
      process.kill(child.pid, signal);
    } catch {
      /* gone */
    }
  };

  const waitPortQuiet = async (timeoutMs: number): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (shuttingDown) return true;
      const h = await fetchHealth(port, 2000);
      if (!h) return true;
      await sleepMs(200);
    }
    return !(await fetchHealth(port, 2000));
  };

  const spawnChild = async (reason: string): Promise<void> => {
    if (shuttingDown || spawning) return;
    if (fs.existsSync(stopPath)) {
      shuttingDown = true;
      return;
    }
    if (child?.pid && processAlive(child.pid)) return;
    if (!fs.existsSync(serverJs)) {
      log(`missing ${serverJs} — skip spawn`);
      return;
    }
    spawning = true;
    try {
      if (logFd == null) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        logFd = fs.openSync(logPath, "a");
      }

      const quiet = await waitPortQuiet(10_000);
      if (!quiet) {
        log("WARN: port still serving — skip spawn (avoid EADDRINUSE burst)");
        return;
      }

      log(`spawn child (${reason})`);
      healthMisses = 0;
      child = spawn("node", [serverJs, "--profile", loaded.profilePath], {
        cwd: workspace,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, MESH_INBOX_SUPERVISED: "1" },
      });
      childStartedAt = Date.now();
      lastBundleMtime = fs.statSync(serverJs).mtimeMs;

      child.on("exit", (code, signal) => {
        child = null;
        writeMeta(undefined);
        if (shuttingDown) {
          log(`child exit during shutdown code=${code ?? "?"} signal=${signal ?? "-"}`);
          return;
        }
        restarts++;
        log(
          `child exit code=${code ?? "?"} signal=${signal ?? "-"} — restart in ${restartDelayMs}ms (#${restarts})`,
        );
        const t = setTimeout(() => {
          void spawnChild("crash-restart");
        }, restartDelayMs);
        timers.push(t);
      });

      const health = await waitForHealth(port, 15_000);
      if (!health) {
        log("WARN: child did not become healthy in 15s");
        writeMeta(child.pid ?? undefined);
        return;
      }
      writeMeta(Number(health.pid ?? child.pid ?? 0) || child.pid);
      log(`child healthy pid=${String(health.pid ?? child.pid ?? "?")}`);
    } finally {
      spawning = false;
    }
  };

  const shutdown = (why: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutdown (${why})`);
    for (const t of timers.splice(0)) clearInterval(t);
    stopChild("SIGTERM");
    const t = setTimeout(() => stopChild("SIGKILL"), 3000);
    timers.push(t);
    if (fs.existsSync(stopPath)) {
      try {
        fs.unlinkSync(stopPath);
      } catch {
        /* ignore */
      }
    }
  };

  writeMeta(undefined);
  log(
    `watching ${serverJs} port=:${port} restartDelay=${restartDelayMs}ms hmrPoll=${hmrPollMs}ms ` +
      `healthWatch=${healthWatchMs}ms timeout=${healthTimeoutMs}ms miss=${healthMissThreshold}`,
  );
  void spawnChild("initial");

  const hmrTimer = setInterval(() => {
    if (shuttingDown || !child?.pid) return;
    if (fs.existsSync(stopPath)) {
      shutdown("stop-file");
      return;
    }
    try {
      if (!fs.existsSync(serverJs)) return;
      const mtime = fs.statSync(serverJs).mtimeMs;
      if (mtime > lastBundleMtime + 1) {
        if (ocV2InflightBlocksHmr(ocV2InflightPath, ocV2HmrBlockMs)) {
          log("HMR deferred — OC-V2 inflight active (avoid mid-reboot kill)");
          return;
        }
        lastBundleMtime = mtime;
        log("HMR: server bundle changed — restarting child");
        stopChild("SIGTERM");
      }
    } catch (e) {
      log(`hmr stat error ${(e as Error).message}`);
    }
  }, hmrPollMs);
  timers.push(hmrTimer);

  const orphanTimer = setInterval(() => {
    if (shuttingDown) return;
    if (fs.existsSync(stopPath)) {
      shutdown("stop-file");
      return;
    }
    if (!child?.pid && !shuttingDown) {
      void spawnChild("orphan-recover");
    } else if (child?.pid && !processAlive(child.pid)) {
      child = null;
    }
  }, Math.max(hmrPollMs, 3000));
  timers.push(orphanTimer);

  const healthTimer = setInterval(() => {
    if (shuttingDown || spawning || !child?.pid) return;
    if (!processAlive(child.pid)) return;
    if (Date.now() - childStartedAt < 45_000) return;
    void (async () => {
      const h = await fetchHealth(port, healthTimeoutMs);
      if (h?.engine === "@seat-mesh/daemon" && h.ok === true) {
        if (healthMisses > 0) log(`health ok — miss streak cleared (was ${healthMisses})`);
        healthMisses = 0;
        writeMeta(Number(h.pid ?? child?.pid ?? 0) || child?.pid);
        return;
      }
      healthMisses += 1;
      writeMeta(child?.pid ?? undefined);
      log(
        `health miss ${healthMisses}/${healthMissThreshold} (timeout=${healthTimeoutMs}ms) pid=${child?.pid}`,
      );
      if (healthMisses >= healthMissThreshold) {
        log(
          `health rescue — ${healthMissThreshold} consecutive misses; SIGKILL child (CPU-starve / wedged loop)`,
        );
        healthMisses = 0;
        stopChild("SIGKILL");
      }
    })();
  }, healthWatchMs);
  timers.push(healthTimer);

  return {
    profilePath: loaded.profilePath,
    port,
    session: loaded.sessionName,
    pid: () => child?.pid,
    stop: shutdown,
  };
}

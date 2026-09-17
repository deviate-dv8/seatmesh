#!/usr/bin/env node
/**
 * Mesh inbox supervisor — keeps mesh-inbox-server alive (crash restart + dist HMR).
 * Started by seatmesh --profile .sm engine (session up / reload / ensureMeshInbox), not by hand.
 *
 * Health rescue (load-starved event loop, not crash):
 *   probe /health every 30s with a generous timeout (25s). After 3 consecutive misses,
 *   SIGKILL the child so crash-restart brings it back. Do not use the CLI's short probe.
 *
 * HMR: deferred while OC-V2 inflight heartbeat is fresh (avoid killing mid-reboot/atomics).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile, meshRuntimePaths, resolveDaemonPort, resolveDaemonScript } from "@seat-mesh/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** How often the supervisor probes a live child. */
const HEALTH_WATCH_MS = Number(process.env.MESH_INBOX_HEALTH_WATCH_MS || 30_000);
/** Allow slow /health under OC load (4–12s common; 2s was false-wedging). */
const HEALTH_TIMEOUT_MS = Number(process.env.MESH_INBOX_HEALTH_TIMEOUT_MS || 25_000);
/** Consecutive misses before SIGKILL rescue. */
const HEALTH_MISS_THRESHOLD = Number(process.env.MESH_INBOX_HEALTH_MISS_THRESHOLD || 3);
const OC_V2_INFLIGHT =
  process.env.CPE_OC_LIMIT_V2_INFLIGHT || "/tmp/seatmesh-oc-v2-inflight.json";
/** Skip HMR while V2 heartbeat newer than this. */
const OC_V2_HMR_BLOCK_MS = Number(process.env.OC_V2_HMR_BLOCK_MS || 120_000);

function parseArgs(): { profilePath?: string } {
  const out: { profilePath?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile" && argv[i + 1]) out.profilePath = argv[++i];
  }
  return out;
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

function fetchHealth(
  port: number,
  timeoutMs: number = 2000,
): Promise<Record<string, unknown> | null> {
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

async function waitForHealth(port: number, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await fetchHealth(port, 2000);
    if (h?.engine === "@seat-mesh/daemon" && h.ok === true) return h;
    await sleepMs(200);
  }
  return null;
}

/** True when an OC-V2 episode is mid-flight in some mesh inbox — do not HMR-kill. */
function ocV2InflightBlocksHmr(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(OC_V2_INFLIGHT, "utf8")) as {
      pid?: number;
      heartbeatAt?: number;
    };
    if (!raw || typeof raw.heartbeatAt !== "number") return false;
    if (Date.now() - raw.heartbeatAt > OC_V2_HMR_BLOCK_MS) return false;
    if (typeof raw.pid === "number" && raw.pid > 0 && !processAlive(raw.pid)) return false;
    return true;
  } catch {
    return false;
  }
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

async function main(): Promise<void> {
  const { profilePath } = parseArgs();
  const loaded = loadProfile(profilePath);
  const profile = loaded.profile;
  const workspace = loaded.workspace;
  const port = resolveDaemonPort(profile, workspace);
  const restartDelayMs = profile.daemon?.restartDelayMs ?? 1500;
  const hmrPollMs = profile.daemon?.hmrPollMs ?? 2000;
  const rt = meshRuntimePaths(loaded);
  const stateDir = rt.daemonDir;
  const metaPath = rt.meshInboxMeta;
  const stopPath = rt.meshInboxStop;
  const logPath = rt.meshInboxLog;
  const serverJs = resolveDaemonScript("mesh-inbox-server.js");

  if (!fs.existsSync(serverJs)) {
    console.error(`mesh-inbox-supervisor: missing ${serverJs} — run seatmesh --profile .sm reload`);
    process.exit(1);
  }

  let shuttingDown = false;
  let spawning = false;
  let child: ChildProcess | null = null;
  let childStartedAt = 0;
  let restarts = 0;
  let healthMisses = 0;
  let lastBundleMtime = fs.statSync(serverJs).mtimeMs;
  let logFd: number | null = null;
  const supervisorStartedAt = new Date().toISOString();

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
      startedAt: supervisorStartedAt,
    };
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  };

  const log = (msg: string) => {
    appendLog(logPath, `[supervisor] ${msg}`);
    console.error(`mesh-inbox-supervisor: ${msg}`);
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
        setTimeout(() => {
          void spawnChild("crash-restart");
        }, restartDelayMs);
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
    stopChild("SIGTERM");
    setTimeout(() => stopChild("SIGKILL"), 3000);
    if (fs.existsSync(stopPath)) {
      try {
        fs.unlinkSync(stopPath);
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => process.exit(0), 500);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  writeMeta(undefined);
  log(
    `watching ${serverJs} port=:${port} restartDelay=${restartDelayMs}ms hmrPoll=${hmrPollMs}ms ` +
      `healthWatch=${HEALTH_WATCH_MS}ms timeout=${HEALTH_TIMEOUT_MS}ms miss=${HEALTH_MISS_THRESHOLD}`,
  );
  await spawnChild("initial");

  setInterval(() => {
    if (shuttingDown || !child?.pid) return;
    if (fs.existsSync(stopPath)) {
      shutdown("stop-file");
      return;
    }
    try {
      const mtime = fs.statSync(serverJs).mtimeMs;
      if (mtime > lastBundleMtime + 1) {
        if (ocV2InflightBlocksHmr()) {
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

  // Keep supervisor alive even if spawnChild throws once.
  setInterval(() => {
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

  // Generous /health rescue — CPU-starved loop looks "up" to ss but never answers.
  setInterval(() => {
    if (shuttingDown || spawning || !child?.pid) return;
    if (!processAlive(child.pid)) return;
    // Grace: skip first 45s after spawn (boot / scrape storm).
    if (Date.now() - childStartedAt < 45_000) return;
    void (async () => {
      const h = await fetchHealth(port, HEALTH_TIMEOUT_MS);
      if (h?.engine === "@seat-mesh/daemon" && h.ok === true) {
        if (healthMisses > 0) {
          log(`health ok — miss streak cleared (was ${healthMisses})`);
        }
        healthMisses = 0;
        writeMeta(Number(h.pid ?? child?.pid ?? 0) || child?.pid);
        return;
      }
      healthMisses += 1;
      writeMeta(child?.pid ?? undefined);
      log(
        `health miss ${healthMisses}/${HEALTH_MISS_THRESHOLD} (timeout=${HEALTH_TIMEOUT_MS}ms) pid=${child?.pid}`,
      );
      if (healthMisses >= HEALTH_MISS_THRESHOLD) {
        log(
          `health rescue — ${HEALTH_MISS_THRESHOLD} consecutive misses; SIGKILL child (CPU-starve / wedged loop)`,
        );
        healthMisses = 0;
        stopChild("SIGKILL");
      }
    })();
  }, HEALTH_WATCH_MS);
}

void main().catch((e) => {
  console.error(`mesh-inbox-supervisor fatal: ${(e as Error).message}`);
  process.exit(1);
});

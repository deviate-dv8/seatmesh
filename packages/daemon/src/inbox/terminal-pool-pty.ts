import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import * as pty from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";
import {
  meshRuntimePaths,
  type LoadedProfile,
  type TpJobRow,
  type TpWorkerSnapshot,
} from "@seat-mesh/core";
import type { PeerRow } from "../store/jsonl-store.js";
import type { QueueStore } from "../store/create-queue-store.js";
import type { TerminalPoolDrainCtx } from "./terminal-pool-drain.js";

const TP_DEFAULT_TIMEOUT_MS = 3_600_000;
const TP_STDOUT_PEER_CAP = 3500;
const TP_ATTACH_BUFFER_CAP = 48_000;
const MAX_WS_BUFFER = 512 * 1024;

type ActivePty = {
  term: pty.IPty;
  timer: ReturnType<typeof setTimeout>;
  logStream: fs.WriteStream;
  outPath: string;
  errPath: string;
};

type PoolWorker = {
  id: number;
  job: TpJobRow | null;
  active: ActivePty | null;
  attachWs: WebSocket | null;
  ring: string;
};

export interface TpPtyPool {
  workerCount: number;
  snapshots: () => TpWorkerSnapshot[];
  findWorkerForJob: (jobId: string) => PoolWorker | null;
  startJob: (ctx: TerminalPoolDrainCtx, row: TpJobRow) => boolean;
  attachWebSocket: (
    server: import("node:http").Server,
    log: (line: string) => void,
  ) => void;
  shutdown: () => void;
}

function appendRing(worker: PoolWorker, data: string): void {
  worker.ring += data;
  if (worker.ring.length > TP_ATTACH_BUFFER_CAP) {
    worker.ring = worker.ring.slice(-TP_ATTACH_BUFFER_CAP);
  }
}

function deliverTpResult(ctx: TerminalPoolDrainCtx, row: TpJobRow): void {
  if (!row.requesterPane.startsWith("%")) return;

  let stdoutTail = "";
  try {
    if (row.stdoutPath && fs.existsSync(row.stdoutPath)) {
      const raw = fs.readFileSync(row.stdoutPath, "utf8");
      stdoutTail = raw.length > TP_STDOUT_PEER_CAP ? raw.slice(-TP_STDOUT_PEER_CAP) : raw;
    }
  } catch {
    stdoutTail = "";
  }

  const relOut = row.stdoutPath
    ? path.relative(ctx.loaded.workspace, row.stdoutPath)
    : undefined;
  const statusWord = row.status === "done" ? "done" : "failed";
  const lines = [
    `[mesh-inbox] TP ${statusWord} job=${row.id.slice(0, 8)} exit=${row.exitCode ?? "?"}`,
    `cmd: ${row.cmd}`,
  ];
  if (row.workerId != null) lines.push(`worker: ${row.workerId}`);
  if (row.error) lines.push(`err: ${row.error}`);
  if (stdoutTail.trim()) {
    lines.push("--- stdout (tail) ---", stdoutTail.trimEnd());
  }
  if (relOut && !relOut.startsWith("..")) lines.push(`log: ${relOut}`);

  const msg = lines.join("\n");
  const peer: PeerRow = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: "prompt",
    fromSlot: "tp",
    fromPorts: null,
    targetPane: row.requesterPane,
    targetLabel: row.requesterSeat,
    msg,
    sent: false,
  };
  ctx.appendPeer(peer);
}

function deliverTpReady(ctx: TerminalPoolDrainCtx, row: TpJobRow): void {
  if (!row.interactive || !row.requesterPane.startsWith("%")) return;
  const attach = `seatmesh agent tp attach ${row.id.slice(0, 8)}`;
  const msg = [
    `[mesh-inbox] TP ready (interactive) job=${row.id.slice(0, 8)} worker=${row.workerId ?? "?"}`,
    `cmd: ${row.cmd}`,
    `attach: ${attach}`,
    `workers: seatmesh agent tp workers`,
  ].join("\n");
  const peer: PeerRow = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: "prompt",
    fromSlot: "tp",
    fromPorts: null,
    targetPane: row.requesterPane,
    targetLabel: row.requesterSeat,
    msg,
    sent: false,
  };
  ctx.appendPeer(peer);
}

function finalizeJob(
  ctx: TerminalPoolDrainCtx,
  worker: PoolWorker,
  exitCode: number,
  errMsg?: string,
): void {
  const row = worker.job;
  if (!row) return;

  if (worker.active) {
    clearTimeout(worker.active.timer);
    try {
      worker.active.logStream.end();
    } catch {
      /* ignore */
    }
    worker.active = null;
  }

  if (worker.attachWs) {
    try {
      worker.attachWs.send(
        `\r\n\x1b[90m[seatmesh] TP job ${row.id.slice(0, 8)} finished exit=${exitCode}\x1b[0m\r\n`,
      );
      worker.attachWs.close();
    } catch {
      /* ignore */
    }
    worker.attachWs = null;
  }

  row.exitCode = exitCode;
  row.finishedAt = new Date().toISOString();
  row.status = exitCode === 0 && !errMsg ? "done" : "failed";
  if (errMsg) row.error = errMsg;
  ctx.store.updateTpJob(row);
  deliverTpResult(ctx, row);
  ctx.log(`TP ${row.status} ${row.id.slice(0, 8)} exit=${exitCode} worker=${worker.id}`);

  worker.job = null;
  worker.ring = "";
}

export function createTpPtyPool(loaded: LoadedProfile, workerCount: number): TpPtyPool {
  const count = Math.max(1, Math.min(8, workerCount));
  const workers: PoolWorker[] = Array.from({ length: count }, (_, id) => ({
    id,
    job: null,
    active: null,
    attachWs: null,
    ring: "",
  }));

  function idleWorker(): PoolWorker | null {
    return workers.find((w) => !w.job) ?? null;
  }

  function snapshots(): TpWorkerSnapshot[] {
    return workers.map((w) => ({
      workerId: w.id,
      status: w.job ? "running" : "idle",
      jobId: w.job?.id,
      requesterSeat: w.job?.requesterSeat,
      cmd: w.job?.cmd,
      summary: w.job?.summary,
      attachBusy: Boolean(w.attachWs),
    }));
  }

  function findWorkerForJob(jobId: string): PoolWorker | null {
    const needle = jobId.trim().toLowerCase();
    return (
      workers.find((w) => w.job?.id.toLowerCase().startsWith(needle)) ??
      workers.find((w) => w.job?.id.toLowerCase() === needle) ??
      null
    );
  }

  function startJob(ctx: TerminalPoolDrainCtx, row: TpJobRow): boolean {
    const worker = idleWorker();
    if (!worker) return false;

    const rt = meshRuntimePaths(loaded);
    fs.mkdirSync(rt.tpJobsDir, { recursive: true });
    const outPath = path.join(rt.tpJobsDir, `${row.id}.out`);
    const errPath = path.join(rt.tpJobsDir, `${row.id}.err`);
    const cwd = row.cwd || loaded.workspace;
    const logStream = fs.createWriteStream(outPath, { flags: "w" });

    row.workerId = worker.id;
    row.stdoutPath = outPath;
    row.stderrPath = errPath;
    worker.job = row;
    worker.ring = "";

    const env = {
      ...process.env,
      SEATMESH_TP_JOB: row.id,
      SEATMESH_TP_SEAT: row.requesterSeat,
      SEATMESH_TP_WORKER: String(worker.id),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>;

    let term: pty.IPty;
    try {
      term = pty.spawn("bash", ["-lc", row.cmd], {
        name: "xterm-256color",
        cols: 120,
        rows: 36,
        cwd,
        env,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logStream.end();
      row.error = msg;
      worker.job = null;
      row.status = "failed";
      row.finishedAt = new Date().toISOString();
      ctx.store.updateTpJob(row);
      deliverTpResult(ctx, row);
      return true;
    }

    const timer = setTimeout(() => {
      try {
        term.kill();
      } catch {
        /* ignore */
      }
      if (worker.job?.id === row.id) {
        finalizeJob(ctx, worker, 124, `timeout after ${TP_DEFAULT_TIMEOUT_MS}ms`);
      }
    }, TP_DEFAULT_TIMEOUT_MS);

    worker.active = { term, timer, logStream, outPath, errPath };

    term.onData((data) => {
      appendRing(worker, data);
      try {
        logStream.write(data);
      } catch {
        /* ignore */
      }
      const attachWs = worker.attachWs;
      if (attachWs && attachWs.readyState === attachWs.OPEN) {
        if (attachWs.bufferedAmount > MAX_WS_BUFFER) return;
        try {
          attachWs.send(data);
        } catch {
          /* ignore */
        }
      }
    });

    term.onExit(({ exitCode }) => {
      if (worker.job?.id === row.id) {
        finalizeJob(ctx, worker, exitCode ?? 1);
      }
    });

    ctx.store.updateTpJob(row);
    if (row.interactive) {
      deliverTpReady(ctx, row);
    }
    return true;
  }

  function attachWebSocket(
    server: import("node:http").Server,
    log: (line: string) => void,
  ): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const host = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== "/ws/tp") return;

      const jobRaw = url.searchParams.get("job")?.trim() || "";
      const workerRaw = url.searchParams.get("worker")?.trim() || "";
      const seat = url.searchParams.get("seat")?.trim() || "";
      const cols = Math.max(40, Math.min(300, Number(url.searchParams.get("cols") || 120) || 120));
      const rows = Math.max(10, Math.min(100, Number(url.searchParams.get("rows") || 36) || 36));

      wss.handleUpgrade(req, socket, head, (ws) => {
        let worker: PoolWorker | null = null;
        if (jobRaw) worker = findWorkerForJob(jobRaw);
        else if (workerRaw !== "") {
          const id = Number(workerRaw);
          worker = workers.find((w) => w.id === id) ?? null;
        }

        if (!worker?.job || !worker.active) {
          ws.send("\r\n[seatmesh] TP worker/job not running — tp workers\r\n");
          ws.close();
          return;
        }
        if (seat && worker.job.requesterSeat !== seat) {
          ws.send("\r\n[seatmesh] attach denied — not your job\r\n");
          ws.close();
          return;
        }
        if (worker.attachWs) {
          ws.send("\r\n[seatmesh] attach busy — disconnect the other client first\r\n");
          ws.close();
          return;
        }

        worker.attachWs = ws;
        log(`tp-attach open worker=${worker.id} job=${worker.job.id.slice(0, 8)} seat=${seat || "?"}`);

        try {
          worker.active.term.resize(cols, rows);
        } catch {
          /* ignore */
        }

        ws.send(
          `\r\n\x1b[32m[seatmesh] TP attach worker=${worker.id} job=${worker.job.id.slice(0, 8)} — interactive\x1b[0m\r\n`,
        );
        if (worker.ring) ws.send(worker.ring);

        ws.on("message", (raw) => {
          const data = typeof raw === "string" ? raw : Buffer.from(raw as Buffer).toString("utf8");
          if (data.startsWith("{") && data.includes('"type"')) {
            try {
              const msg = JSON.parse(data) as { type?: string; cols?: number; rows?: number };
              if (msg.type === "resize" && msg.cols && msg.rows && worker?.active) {
                worker.active.term.resize(
                  Math.max(40, Math.min(300, msg.cols)),
                  Math.max(10, Math.min(100, msg.rows)),
                );
                return;
              }
            } catch {
              /* terminal input */
            }
          }
          if (!worker?.active) return;
          try {
            worker.active.term.write(data);
          } catch {
            /* ignore */
          }
        });

        const cleanup = () => {
          if (worker) worker.attachWs = null;
          log(`tp-attach close worker=${worker?.id ?? "?"} job=${worker?.job?.id.slice(0, 8) ?? "-"}`);
        };
        ws.on("close", cleanup);
        ws.on("error", cleanup);
      });
    });
  }

  function shutdown(): void {
    for (const w of workers) {
      if (w.attachWs) {
        try {
          w.attachWs.close();
        } catch {
          /* ignore */
        }
      }
      if (w.active) {
        clearTimeout(w.active.timer);
        try {
          w.active.term.kill();
        } catch {
          /* ignore */
        }
        try {
          w.active.logStream.end();
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    workerCount: count,
    snapshots,
    findWorkerForJob,
    startJob,
    attachWebSocket,
    shutdown,
  };
}

export function resolveTpJobByNeedle(store: QueueStore, needle: string): TpJobRow | null {
  const n = needle.trim().toLowerCase();
  if (!n) return null;
  const rows = store.readTpJobs();
  return (
    rows.find((r) => r.id.toLowerCase().startsWith(n)) ??
    rows.find((r) => r.id.toLowerCase() === n) ??
    null
  );
}

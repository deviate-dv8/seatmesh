import { spawnSync } from "node:child_process";
import type { LoadedProfile, TpJobRow, TpWorkerSnapshot } from "@seat-mesh/core";
import { ensureMeshInbox, meshInboxPort } from "../comms/inbox-bridge.js";
import { runWhoami } from "../agents/whoami.js";

function inboxBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function tpWho(loaded: LoadedProfile): { seat: string; pane: string } {
  if (!process.env.TMUX_PANE) {
    return { seat: "shell", pane: "%0" };
  }
  const w = runWhoami(loaded, "here");
  const seat =
    w.slotLabel ??
    (w.slot != null ? `slot-${w.slot}` : w.role || "unknown");
  return { seat, pane: w.paneId ?? process.env.TMUX_PANE };
}

function curlJson(
  port: number,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Record<string, unknown> | null {
  const args =
    method === "GET"
      ? ["-sS", "-m", "8", `${inboxBase(port)}${path}`]
      : [
          "-sS",
          "-m",
          "12",
          "-X",
          "POST",
          `${inboxBase(port)}${path}`,
          "-H",
          "Content-Type: application/json",
          "-d",
          JSON.stringify(body ?? {}),
        ];
  const r = spawnSync("curl", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

export function listTpJobs(loaded: LoadedProfile, opts: { all?: boolean } = {}): TpJobRow[] {
  const port = meshInboxPort(loaded);
  const { seat } = tpWho(loaded);
  const q = opts.all ? "?all=1" : `?requester=${encodeURIComponent(seat)}`;
  const resp = curlJson(port, "GET", `/tp${q}`);
  return (resp?.rows as TpJobRow[] | undefined) ?? [];
}

export function listTpWorkers(loaded: LoadedProfile): TpWorkerSnapshot[] {
  const port = meshInboxPort(loaded);
  const resp = curlJson(port, "GET", "/tp/workers");
  return (resp?.workers as TpWorkerSnapshot[] | undefined) ?? [];
}

export function tpWsBase(loaded: LoadedProfile): string {
  const port = meshInboxPort(loaded);
  return `ws://127.0.0.1:${port}/ws/tp`;
}

export function submitTpJob(
  loaded: LoadedProfile,
  cmd: string,
  opts: { cwd?: string; summary?: string; interactive?: boolean } = {},
): TpJobRow | null {
  ensureMeshInbox(loaded, { quiet: true });
  const port = meshInboxPort(loaded);
  const who = tpWho(loaded);
  const resp = curlJson(port, "POST", "/tp/submit", {
    cmd,
    cwd: opts.cwd,
    summary: opts.summary,
    requesterSeat: who.seat,
    requesterPane: who.pane,
    interactive: opts.interactive !== false,
  });
  if (!resp?.ok) return null;
  return (resp.entry as TpJobRow | undefined) ?? null;
}

export function printTpList(loaded: LoadedProfile, mineOnly = true): void {
  const rows = listTpJobs(loaded, { all: !mineOnly });
  const open = rows.filter((r) => r.status === "pending" || r.status === "running");
  if (!rows.length) {
    console.log("tp: queue empty");
    return;
  }
  for (const r of rows.slice(-20)) {
    const w = r.workerId != null ? ` w=${r.workerId}` : "";
    const mode = r.interactive === false ? " batch" : " interactive";
    console.log(
      `${r.id.slice(0, 8)} ${r.status}${mode}${w} seat=${r.requesterSeat} exit=${r.exitCode ?? "-"} — ${r.summary ?? r.cmd.slice(0, 72)}`,
    );
  }
  console.log(`tp: ${open.length} open / ${rows.length} shown`);
}

export function printTpWorkers(loaded: LoadedProfile): void {
  const workers = listTpWorkers(loaded);
  if (!workers.length) {
    console.log("tp workers: (none — inbox restart after upgrade)");
    return;
  }
  for (const w of workers) {
    const job = w.jobId ? ` job=${w.jobId.slice(0, 8)}` : "";
    const seat = w.requesterSeat ? ` seat=${w.requesterSeat}` : "";
    const attach = w.attachBusy ? " attach=busy" : "";
    console.log(
      `worker-${w.workerId} ${w.status}${job}${seat}${attach} — ${w.summary ?? w.cmd ?? "(idle)"}`,
    );
  }
  console.log(`attach: seatmesh agent tp attach <job-id|worker-N>`);
}

export function watchTpJob(loaded: LoadedProfile, jobId?: string, timeoutMs = 3_600_000): TpJobRow | null {
  const { seat } = tpWho(loaded);
  const needle = jobId?.trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = listTpJobs(loaded, { all: false });
    const hit = needle
      ? rows.find((r) => r.id.toLowerCase().startsWith(needle))
      : rows.find((r) => r.status === "pending" || r.status === "running");
    if (hit && (hit.status === "done" || hit.status === "failed" || hit.status === "cancelled")) {
      return hit;
    }
    if (needle) {
      const done = rows.find((r) => r.id.toLowerCase().startsWith(needle));
      if (done && done.status !== "pending" && done.status !== "running") return done;
    }
    spawnSync("sleep", ["2"]);
  }
  console.error(`tp watch: timeout seat=${seat}`);
  return null;
}

/** Interactive attach — stdin/stdout wired to pooled PTY (Node 22+ WebSocket). */
export async function attachTpSession(
  loaded: LoadedProfile,
  target: string,
): Promise<number> {
  ensureMeshInbox(loaded, { quiet: true });
  const { seat } = tpWho(loaded);
  const raw = target.trim();
  if (!raw) {
    console.error("usage: tp attach <job-id|worker-N>");
    return 2;
  }

  const workerMatch = /^worker-?(\d+)$/i.exec(raw);
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 36;
  const base = tpWsBase(loaded);
  const params = new URLSearchParams({
    seat,
    cols: String(cols),
    rows: String(rows),
  });
  if (workerMatch) params.set("worker", workerMatch[1]!);
  else params.set("job", raw);

  const url = `${base}?${params.toString()}`;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("tp attach: requires a TTY (run from agent shell pane)");
    return 2;
  }

  const ws = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("connect timeout")), 12_000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("websocket error"));
    });
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\x1b[?25h");

  const onData = (buf: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(buf.toString("utf8"));
  };
  const onMsg = (ev: MessageEvent) => {
    const data = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString("utf8");
    process.stdout.write(data);
  };
  const onResize = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "resize",
        cols: process.stdout.columns || 120,
        rows: process.stdout.rows || 36,
      }),
    );
  };

  process.stdin.on("data", onData);
  ws.addEventListener("message", onMsg);
  process.stdout.on("resize", onResize);

  const code = await new Promise<number>((resolve) => {
    const cleanup = (exitCode: number) => {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      process.stdin.off("data", onData);
      process.stdout.off("resize", onResize);
      ws.removeEventListener("message", onMsg);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(exitCode);
    };
    ws.addEventListener("close", () => cleanup(0));
    ws.addEventListener("error", () => cleanup(1));
    process.stdin.on("end", () => cleanup(0));
  });

  process.stdout.write("\r\n");
  return code;
}

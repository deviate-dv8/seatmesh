import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  meshRuntimePaths,
  resolveDaemonPort,
  resolveDaemonScript,
  seatmeshInboxDown,
  seatmeshInboxRestart,
  type LoadedProfile,
} from "@seat-mesh/core";
import { armAfterPeer } from "./chat-checkback.js";

function inboxBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

interface MeshInboxMeta {
  supervisorPid?: number;
  pid?: number;
  port?: number;
  watch?: boolean;
  hmr?: boolean;
  session?: string;
  workspaceId?: string;
  startedAt?: string;
  storage?: string;
  sqlitePath?: string;
}

function enginePaths() {
  return {
    serverJs: resolveDaemonScript("mesh-inbox-server.js"),
    supervisorJs: resolveDaemonScript("mesh-inbox-supervisor.js"),
  };
}

function meshDaemonPaths(loaded: LoadedProfile) {
  const rt = meshRuntimePaths(loaded);
  const engine = enginePaths();
  return {
    stateDir: rt.daemonDir,
    metaPath: rt.meshInboxMeta,
    stopPath: rt.meshInboxStop,
    logPath: rt.meshInboxLog,
    serverJs: engine.serverJs,
    supervisorJs: engine.supervisorJs,
    profileDir: loaded.profileDir,
  };
}

export function readMeshInboxMeta(loaded: LoadedProfile): MeshInboxMeta | null {
  const { metaPath } = meshDaemonPaths(loaded);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as MeshInboxMeta;
  } catch {
    return null;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  const r = spawnSync("kill", ["-0", String(pid)], { stdio: "ignore" });
  return r.status === 0;
}

function watchEnabled(loaded: LoadedProfile): boolean {
  return loaded.profile.daemon?.watch !== false;
}

export function meshInboxPort(loaded: LoadedProfile): number {
  return resolveDaemonPort(loaded.profile, loaded.workspace);
}

export function inboxHealth(port: number, timeoutSec = 2): Record<string, unknown> | null {
  const r = spawnSync("curl", ["-sS", "-m", String(timeoutSec), `${inboxBase(port)}/health`], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout.trim() };
  }
}

/** Report/CLI: daemon may miss a 2s probe while draining — retry before claiming down. */
export function inboxHealthRelaxed(
  port: number,
  opts: { timeoutSec?: number; retries?: number; pauseMs?: number } = {},
): Record<string, unknown> | null {
  const timeoutSec = opts.timeoutSec ?? 5;
  const retries = opts.retries ?? 4;
  const pauseMs = opts.pauseMs ?? 350;
  for (let i = 0; i < retries; i++) {
    const h = inboxHealth(port, timeoutSec);
    if (h?.engine === "@seat-mesh/daemon") return h;
    if (i + 1 < retries) spawnSync("sleep", [String(pauseMs / 1000)]);
  }
  return inboxHealth(port, timeoutSec);
}

export type InboxProbe = "healthy" | "down" | "wedged";

function tcpPortListening(port: number): boolean {
  const r = spawnSync("ss", ["-ltn", `sport = :${port}`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.includes(`:${port}`);
}

/** healthy = daemon JSON; wedged = port open but /health hung (must fuser-kill). */
export function probeInbox(port: number): InboxProbe {
  const h = inboxHealth(port);
  if (h?.engine === "@seat-mesh/daemon") return "healthy";
  if (tcpPortListening(port)) return "wedged";
  return "down";
}

export function killWedgedInboxListener(port: number): void {
  spawnSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
  spawnSync("sleep", ["0.4"]);
}

export interface InboxStartOptions {
  quiet?: boolean;
}

export interface SendToMasterOptions {
  from?: string;
  slot?: string;
  ports?: string;
}

export type PeerEnqueueKind = "to-slot" | "to-mini" | "prompt" | "remind" | "room";

export interface EnqueuePeerOptions {
  kind: PeerEnqueueKind;
  msg: string;
  targetPane: string;
  targetLabel: string;
  fromSlot?: string;
  fromPorts?: string | null;
  roomSlug?: string | null;
  fromAgent?: string | null;
  /** Fan-out batch: caller already ensured inbox once. */
  skipEnsure?: boolean;
}

export function enqueuePeer(
  loaded: LoadedProfile,
  opts: EnqueuePeerOptions,
): Record<string, unknown> | null {
  const port = meshInboxPort(loaded);
  if (!opts.skipEnsure && !ensureMeshInbox(loaded, { quiet: true })) return null;
  const body = JSON.stringify({
    kind: opts.kind,
    msg: opts.msg,
    targetPane: opts.targetPane,
    targetLabel: opts.targetLabel,
    fromSlot: opts.fromSlot,
    fromPorts: opts.fromPorts,
    roomSlug: opts.roomSlug,
    fromAgent: opts.fromAgent,
  });
  const r = spawnSync(
    "curl",
    ["-sS", "-m", "5", "-X", "POST", `${inboxBase(port)}/to-peer`, "-H", "Content-Type: application/json", "-d", body],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

export interface RoomFanoutTarget {
  targetPane: string;
  targetLabel: string;
  msg: string;
}

export interface EnqueueRoomFanoutResult {
  ok: boolean;
  enqueued: number;
  skipped?: number;
  error?: string;
}

/**
 * Batch-enqueue room pings via POST /room-fanout (one HTTP call).
 * Prefer this over N× /to-peer so global broadcast does not storm bypass injects.
 */
export function enqueueRoomFanout(
  loaded: LoadedProfile,
  opts: {
    fromSlot: string;
    fromPorts?: string | null;
    roomSlug: string;
    fromAgent?: string | null;
    excludePane?: string | null;
    targets: RoomFanoutTarget[];
    skipEnsure?: boolean;
  },
): EnqueueRoomFanoutResult {
  if (!opts.targets.length) return { ok: true, enqueued: 0 };
  const port = meshInboxPort(loaded);
  if (!opts.skipEnsure && !ensureMeshInbox(loaded, { quiet: true })) {
    return { ok: false, enqueued: 0, error: "inbox ensure failed" };
  }
  // Warm /health with retries — burst drain can make a single 2s probe look down.
  inboxHealthRelaxed(port, { retries: 3, pauseMs: 200, timeoutSec: 3 });
  const body = JSON.stringify({
    fromSlot: opts.fromSlot,
    fromPorts: opts.fromPorts ?? null,
    roomSlug: opts.roomSlug,
    fromAgent: opts.fromAgent ?? null,
    excludePane: opts.excludePane ?? null,
    targets: opts.targets,
  });
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "15",
      "-X",
      "POST",
      `${inboxBase(port)}/room-fanout`,
      "-H",
      "Content-Type: application/json",
      "-d",
      body,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    return {
      ok: false,
      enqueued: 0,
      error: r.stderr?.trim() || r.stdout?.trim() || "curl room-fanout failed",
    };
  }
  try {
    const j = JSON.parse(r.stdout || "{}") as {
      ok?: boolean;
      enqueued?: number;
      skipped?: number;
      error?: string;
    };
    if (j.ok === false) {
      return { ok: false, enqueued: 0, error: j.error ?? "room-fanout rejected" };
    }
    return {
      ok: true,
      enqueued: typeof j.enqueued === "number" ? j.enqueued : opts.targets.length,
      skipped: j.skipped,
    };
  } catch {
    return { ok: false, enqueued: 0, error: "bad room-fanout JSON" };
  }
}

function autoStartEnabled(loaded: LoadedProfile): boolean {
  return loaded.profile.daemon?.autoStart !== false;
}

export interface InboxEntry {
  id: string;
  at: string;
  from: string;
  slot: string | null;
  ports: string | null;
  msg: string;
  sent: boolean;
  sentAt?: string;
  resolved: boolean;
  read: boolean;
}

function inboxHttpGet(port: number, path: string): Record<string, unknown> | null {
  const r = spawnSync("curl", ["-sS", "-m", "5", `${inboxBase(port)}${path}`], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout.trim() };
  }
}

function inboxHttpPost(port: number, path: string, body: Record<string, unknown>): Record<string, unknown> | null {
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "5",
      "-X",
      "POST",
      `${inboxBase(port)}${path}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout.trim() };
  }
}

function requireInboxUp(loaded: LoadedProfile): number | null {
  const port = meshInboxPort(loaded);
  const probe = probeInbox(port);
  if (probe === "wedged") {
    killWedgedInboxListener(port);
    startMeshInbox(loaded, { quiet: true });
  }
  if (ensureMeshInbox(loaded, { quiet: true })) return port;
  console.error(seatmeshInboxDown(port));
  return null;
}

/** Unresolved manager inbox rows (mesh daemon GET /inbox). */
export function listInbox(
  loaded: LoadedProfile,
  opts: { all?: boolean; json?: boolean } = {},
): InboxEntry[] | null {
  const port = requireInboxUp(loaded);
  if (port == null) return null;
  const path = opts.all ? "/inbox?all=1" : "/inbox";
  const resp = inboxHttpGet(port, path);
  if (!resp || resp.ok !== true) {
    console.error(`inbox list failed on :${port}`);
    return null;
  }
  const entries = (resp.entries ?? []) as InboxEntry[];
  if (opts.json) {
    console.log(JSON.stringify(resp, null, 2));
    return entries;
  }
  if (!entries.length) {
    console.log(`inbox: 0 ${opts.all ? "total" : "unresolved"} (session=${loaded.sessionName})`);
    return entries;
  }
  for (const row of entries) {
    const flags = [
      row.resolved ? "resolved" : "open",
      row.sent ? "sent" : "unsent",
    ].join(",");
    console.log(
      `${row.at}  ${row.id.slice(0, 8)}  slot=${row.slot ?? "-"}  ${flags}  ${row.msg}`,
    );
  }
  console.log(`inbox: ${entries.length} ${opts.all ? "total" : "unresolved"}`);
  return entries;
}

/** Mark inbox rows resolved (mesh daemon POST /inbox/resolve). */
export function resolveInbox(
  loaded: LoadedProfile,
  opts: { id?: string; all?: boolean; json?: boolean } = {},
): { resolved: number; ids: string[] } | null {
  const port = requireInboxUp(loaded);
  if (port == null) return null;
  const body: Record<string, unknown> = {};
  if (opts.all) body.all = true;
  else if (opts.id) body.id = opts.id;
  else {
    throw new Error("usage: inbox resolve <id-prefix>|all");
  }
  const resp = inboxHttpPost(port, "/inbox/resolve", body);
  if (!resp || resp.ok !== true) {
    console.error(`inbox resolve failed on :${port}`);
    return null;
  }
  const result = {
    resolved: Number(resp.resolved ?? 0),
    ids: (resp.ids ?? []) as string[],
  };
  if (opts.json) {
    console.log(JSON.stringify(resp, null, 2));
  } else {
    console.log(
      `OK: resolved ${result.resolved} id(s) ${result.ids.map((i) => i.slice(0, 8)).join(",") || "(none)"}`,
    );
  }
  return result;
}

export function sendToMaster(
  loaded: LoadedProfile,
  msg: string,
  opts: SendToMasterOptions = {},
): Record<string, unknown> | null {
  ensureMeshInbox(loaded, { quiet: true });
  const port = meshInboxPort(loaded);
  const body = JSON.stringify({
    msg,
    from: opts.from,
    slot: opts.slot,
    ports: opts.ports,
  });
  const r = spawnSync(
    "curl",
    ["-sS", "-m", "5", "-X", "POST", `${inboxBase(port)}/to-master`, "-H", "Content-Type: application/json", "-d", body],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    armAfterPeer(loaded, "manager", { pane: process.env.TMUX_PANE });
    return parsed;
  } catch {
    return { raw: r.stdout };
  }
}

export function meshInboxStatusLine(
  loaded: LoadedProfile,
  h: Record<string, unknown> | null,
): string {
  const port = meshInboxPort(loaded);
  const ok = Boolean(h && h.engine === "@seat-mesh/daemon");
  const watch = watchEnabled(loaded) ? " watch" : "";
  if (!ok) return `inbox: down :${port} session=${loaded.sessionName}${watch}`;
  return (
    `inbox: up :${port} session=${String(h?.session ?? loaded.sessionName)} ` +
    `workers=${String(h?.workerPanes ?? "?")} minis=${String(h?.miniPanes ?? "?")} ` +
    `ocLimit=${String(h?.ocLimitActive ?? 0)} checkback=${String(h?.checkbackActive ?? 0)}${watch}`
  );
}

export function printInboxStatus(loaded: LoadedProfile): boolean {
  const port = meshInboxPort(loaded);
  const h = inboxHealth(port);
  const ok = Boolean(h && h.engine === "@seat-mesh/daemon");
  console.log(meshInboxStatusLine(loaded, h));
  if (ok && h?.stateDir) {
    console.log(`  state: ${String(h.stateDir)}`);
  }
  if (!ok) {
    console.log(`  log: ${meshDaemonPaths(loaded).logPath}`);
  }
  return ok;
}

export function ensureMeshInbox(
  loaded: LoadedProfile,
  opts: InboxStartOptions = {},
): boolean {
  if (!autoStartEnabled(loaded)) return false;
  const port = meshInboxPort(loaded);
  if (probeInbox(port) === "wedged") {
    killWedgedInboxListener(port);
  }
  const existing = inboxHealth(port);
  if (existing?.engine === "@seat-mesh/daemon") return true;

  const meta = readMeshInboxMeta(loaded);
  if (pidAlive(meta?.supervisorPid)) {
    for (let i = 0; i < 40; i++) {
      const h = inboxHealth(port);
      if (h?.engine === "@seat-mesh/daemon") return true;
      spawnSync("sleep", ["0.25"]);
    }
  }

  if (existing) {
    if (!opts.quiet) {
      throw new Error(
        `port :${port} answered but not @seat-mesh/daemon (engine=${String(existing.engine ?? "?")})`,
      );
    }
    return false;
  }
  try {
    startMeshInbox(loaded, opts);
    return true;
  } catch {
    return false;
  }
}

export function startMeshInbox(
  loaded: LoadedProfile,
  opts: InboxStartOptions = {},
): void {
  const port = meshInboxPort(loaded);
  const { logPath, serverJs, supervisorJs, profileDir, stopPath } = meshDaemonPaths(loaded);
  const useWatch = watchEnabled(loaded);

  const existing = inboxHealth(port);
  if (existing?.engine === "@seat-mesh/daemon") {
    if (!opts.quiet) {
      console.log(`mesh-inbox already up session=${String(existing.session ?? loaded.sessionName)}`);
    }
    return;
  }

  const meta = readMeshInboxMeta(loaded);
  if (pidAlive(meta?.supervisorPid)) {
    if (!opts.quiet) {
      console.log(`mesh-inbox supervisor already running pid=${meta?.supervisorPid}`);
    }
    for (let i = 0; i < 40; i++) {
      const h = inboxHealth(port);
      if (h?.engine === "@seat-mesh/daemon") {
        if (opts.quiet) console.log(meshInboxStatusLine(loaded, h));
        return;
      }
      spawnSync("sleep", ["0.25"]);
    }
  }

  if (existing) {
    throw new Error(
      `port :${port} answered but not @seat-mesh/daemon (engine=${String(existing.engine ?? "?")}) — pick another daemon.port / portScope`,
    );
  }

  const entryJs = useWatch ? supervisorJs : serverJs;
  if (!fs.existsSync(entryJs)) {
    throw new Error(`missing ${entryJs} — run reload (cold start builds dist automatically)`);
  }
  if (useWatch && !fs.existsSync(supervisorJs)) {
    throw new Error(`missing ${supervisorJs} — run reload`);
  }

  try {
    fs.unlinkSync(stopPath);
  } catch {
    /* ignore */
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const profileArg = loaded.profilePath;
  const args = useWatch ? ["--profile", profileArg] : ["--profile", profileArg];
  const child = spawn("node", [entryJs, ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (child.pid == null) {
    throw new Error("mesh-inbox start failed (no pid)");
  }

  for (let i = 0; i < 40; i++) {
    const h = inboxHealth(port);
    if (h?.engine === "@seat-mesh/daemon") {
      if (!opts.quiet) {
        const label = useWatch ? "mesh-inbox (supervised)" : "mesh-inbox";
        console.log(`OK: ${label} on :${port} session=${loaded.sessionName}`);
      }
      return;
    }
    spawnSync("sleep", ["0.25"]);
  }
  throw new Error(`mesh-inbox did not become healthy on ${inboxBase(port)} (see ${logPath})`);
}

function killPortListener(port: number): void {
  spawnSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
  spawnSync("sleep", ["0.3"]);
}

export function stopMeshInbox(loaded: LoadedProfile): void {
  const port = meshInboxPort(loaded);
  const { metaPath, stopPath } = meshDaemonPaths(loaded);

  try {
    fs.writeFileSync(stopPath, `${new Date().toISOString()} stop\n`, { encoding: "utf8" });
  } catch {
    /* ignore */
  }

  const meta = readMeshInboxMeta(loaded);
  if (pidAlive(meta?.supervisorPid)) {
    spawnSync("kill", ["-TERM", String(meta!.supervisorPid!)], { stdio: "ignore" });
  }
  if (pidAlive(meta?.pid)) {
    spawnSync("kill", ["-TERM", String(meta!.pid!)], { stdio: "ignore" });
  }

  for (let i = 0; i < 24; i++) {
    const probe = probeInbox(port);
    if (probe === "down") break;
    if (probe === "wedged" || i === 6 || i === 14) {
      if (pidAlive(meta?.supervisorPid)) {
        spawnSync("kill", ["-KILL", String(meta!.supervisorPid!)], { stdio: "ignore" });
      }
      if (pidAlive(meta?.pid)) {
        spawnSync("kill", ["-KILL", String(meta!.pid!)], { stdio: "ignore" });
      }
      killPortListener(port);
    }
    spawnSync("sleep", ["0.25"]);
  }
  if (probeInbox(port) !== "down") {
    console.log(`WARN: inbox wedged on :${port} — killing listener (${seatmeshInboxRestart()})`);
    killPortListener(port);
    spawnSync("sleep", ["0.5"]);
  }

  try {
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch {
    /* ignore */
  }
  console.log("OK: mesh-inbox stopped");
}

/** True when this profile's inbox has run or is listening (safe to restart after update). */
export function meshInboxEverConfigured(loaded: LoadedProfile): boolean {
  const port = meshInboxPort(loaded);
  if (probeInbox(port) !== "down") return true;
  const meta = readMeshInboxMeta(loaded);
  return Boolean(meta?.supervisorPid || meta?.pid || meta?.startedAt);
}

export function restartMeshInbox(loaded: LoadedProfile): void {
  const port = meshInboxPort(loaded);
  if (probeInbox(port) === "wedged") {
    killWedgedInboxListener(port);
  }
  stopMeshInbox(loaded);
  for (let i = 0; i < 16; i++) {
    if (probeInbox(port) === "down") break;
    killWedgedInboxListener(port);
    spawnSync("sleep", ["0.2"]);
  }
  startMeshInbox(loaded);
  // Self-repair: re-merge jsonl CBs + restore act cards after bounce.
  for (let i = 0; i < 20; i++) {
    if (probeInbox(port) === "healthy") break;
    spawnSync("sleep", ["0.15"]);
  }
  spawnSync(
    "curl",
    ["-sS", "-m", "3", "-X", "POST", `http://127.0.0.1:${port}/repair`],
    { encoding: "utf8", stdio: "ignore" },
  );
}

export function printMeshInboxStatus(
  loaded: LoadedProfile,
  opts: { json?: boolean } = {},
): boolean {
  const port = meshInboxPort(loaded);
  const h = inboxHealth(port);
  const ok = Boolean(h && h.engine === "@seat-mesh/daemon");
  if (opts.json) {
    console.log(
      JSON.stringify(
        h ?? {
          ok: false,
          engine: null,
          port,
          session: loaded.sessionName,
          workspaceId: loaded.workspaceId,
        },
        null,
        2,
      ),
    );
    return ok;
  }
  return printInboxStatus(loaded);
}

/** Retry GET /health until @seat-mesh/daemon answers or timeout (wrapper only; probe stays fast). */
export function waitForMeshInbox(
  loaded: LoadedProfile,
  seconds: number,
  opts: { json?: boolean; meta?: boolean; quiet?: boolean } = {},
): boolean {
  const port = meshInboxPort(loaded);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const h = inboxHealth(port);
    if (h?.engine === "@seat-mesh/daemon") {
      if (opts.meta) printInboxMeta(loaded, { json: opts.json });
      else if (opts.json) console.log(JSON.stringify(h, null, 2));
      else if (!opts.quiet) printInboxStatus(loaded);
      return true;
    }
    spawnSync("sleep", ["0.5"]);
  }
  const { logPath } = meshDaemonPaths(loaded);
  console.error(`FAIL: inbox not healthy on :${port} after ${seconds}s`);
  console.error(`  log: ${logPath}`);
  return false;
}

/** On-disk mesh-inbox.json beside live /health (stale-meta cross-check). */
export function printInboxMeta(
  loaded: LoadedProfile,
  opts: { json?: boolean } = {},
): void {
  const port = meshInboxPort(loaded);
  const paths = meshDaemonPaths(loaded);
  const meta = readMeshInboxMeta(loaded);
  const h = inboxHealth(port);
  const payload = {
    port,
    session: loaded.sessionName,
    metaPath: paths.metaPath,
    logPath: paths.logPath,
    stateDir: paths.stateDir,
    fileMeta: meta,
    supervisorAlive: pidAlive(meta?.supervisorPid),
    serverAlive: pidAlive(meta?.pid),
    health: h ?? null,
    healthOk: Boolean(h && h.engine === "@seat-mesh/daemon"),
  };
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`inbox meta (:${port}) session=${loaded.sessionName}`);
  console.log(`  meta file: ${paths.metaPath}`);
  if (meta) {
    const sup = meta.supervisorPid;
    const srv = meta.pid;
    console.log(
      `  supervisorPid: ${sup ?? "-"} ${pidAlive(sup) ? "(alive)" : "(dead)"}`,
    );
    console.log(`  serverPid: ${srv ?? "-"} ${pidAlive(srv) ? "(alive)" : "(dead)"}`);
    if (meta.startedAt) console.log(`  startedAt: ${meta.startedAt}`);
    if (meta.storage) console.log(`  storage: ${meta.storage}`);
  } else {
    console.log("  (no mesh-inbox.json on disk)");
  }
  console.log(`  log: ${paths.logPath}`);
  console.log("  live /health:");
  if (h?.engine === "@seat-mesh/daemon") {
    console.log(
      `    up pid=${String(h.pid)} workers=${String(h.workerPanes)} minis=${String(h.miniPanes)}`,
    );
    console.log(
      `    inboxUnresolved=${String(h.inboxUnresolved)} peerUnsent=${String(h.peerUnsent)} checkback=${String(h.checkbackActive)}`,
    );
  } else {
    console.log("    down or wrong engine");
  }
}

export function tailInboxLog(
  loaded: LoadedProfile,
  opts: { lines?: number; follow?: boolean } = {},
): boolean {
  const { logPath } = meshDaemonPaths(loaded);
  if (!fs.existsSync(logPath)) {
    console.error(`no log: ${logPath}`);
    return false;
  }
  const lines = opts.lines ?? 50;
  if (opts.follow) {
    const r = spawnSync("tail", ["-f", "-n", String(lines), logPath], { stdio: "inherit" });
    return r.status === 0;
  }
  const r = spawnSync("tail", ["-n", String(lines), logPath], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status === 0;
}

/** pgrep + ss one-shot — find stray mesh-inbox listeners on the daemon port. */
export function listInboxInstances(loaded: LoadedProfile): void {
  const port = meshInboxPort(loaded);
  const paths = meshDaemonPaths(loaded);
  console.log(`mesh-inbox instances (port :${port})`);
  console.log(`  meta:  ${paths.metaPath}`);
  console.log(`  log:   ${paths.logPath}`);
  console.log(`  state: ${paths.stateDir}`);

  const pg = spawnSync("pgrep", ["-af", "mesh-inbox"], { encoding: "utf8" });
  if (pg.stdout?.trim()) {
    console.log("\nProcesses (pgrep -af mesh-inbox):");
    for (const line of pg.stdout.trim().split("\n")) console.log(`  ${line}`);
  } else {
    console.log("\nProcesses: (none matching mesh-inbox)");
  }

  const ss = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  const portLines =
    ss.stdout?.split("\n").filter((l) => l.includes(`:${port}`) || l.includes(`:${port} `)) ??
    [];
  console.log(`\nListeners on :${port}:`);
  if (portLines.length) {
    for (const l of portLines) console.log(`  ${l.trim()}`);
  } else {
    console.log("  (none)");
  }
}

export interface InboxStatusFlags {
  json: boolean;
  meta: boolean;
  waitSec?: number;
}

const INBOX_SUBCMDS = new Set([
  "stop",
  "restart",
  "start",
  "list",
  "all",
  "resolve",
  "read",
  "log",
  "instances",
  "status",
  "unsent",
]);

/** Parse `--json`, `--meta`, `--wait N` from inbox status argv (after optional `status` sub). */
export function parseInboxStatusFlags(args: string[]): InboxStatusFlags {
  let json = false;
  let meta = false;
  let waitSec: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--meta") meta = true;
    else if (a === "--wait") {
      const n = Number(args[i + 1] ?? "30");
      waitSec = Number.isFinite(n) && n > 0 ? n : 30;
      i++;
    }
  }
  return { json, meta, waitSec };
}

export function inboxStatusArgv(sub: string | undefined, tail: (string | undefined)[]): string[] {
  const parts = [sub, ...tail].filter((a): a is string => a != null && a !== "");
  if (parts[0] === "status") return parts.slice(1);
  if (parts[0] && INBOX_SUBCMDS.has(parts[0])) return [];
  return parts;
}

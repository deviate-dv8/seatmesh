import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  meshRuntimePaths,
  resolveDaemonPort,
  resolveDaemonScript,
  type LoadedProfile,
} from "@seat-mesh/core";

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

function readMeshInboxMeta(loaded: LoadedProfile): MeshInboxMeta | null {
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

export function inboxHealth(port: number): Record<string, unknown> | null {
  const r = spawnSync("curl", ["-sS", "-m", "2", `${inboxBase(port)}/health`], {
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout.trim() };
  }
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
  if (ensureMeshInbox(loaded, { quiet: true })) return meshInboxPort(loaded);
  const port = meshInboxPort(loaded);
  console.error(`inbox down on :${port} — run: ./sm.sh inbox restart`);
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
    return JSON.parse(r.stdout) as Record<string, unknown>;
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

  spawnSync("sleep", ["0.5"]);
  const h = inboxHealth(port);
  if (h?.engine === "@seat-mesh/daemon") {
    console.log(`WARN: mesh-inbox still answering /health — retry stop or kill listener on :${port}`);
    killPortListener(port);
  }

  try {
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  } catch {
    /* ignore */
  }
  console.log("OK: mesh-inbox stopped");
}

export function restartMeshInbox(loaded: LoadedProfile): void {
  stopMeshInbox(loaded);
  spawnSync("sleep", ["0.5"]);
  startMeshInbox(loaded);
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

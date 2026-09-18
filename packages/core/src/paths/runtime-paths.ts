import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MeshProfile } from "../schema/profile.js";
import { resolveFromWorkspace } from "./paths.js";
import { buildResolvedPaths, resolveHarnessPath } from "./paths-manifest.js";
import type { LoadedProfile } from "../profile/profile.js";
import type { StorageBackend } from "./paths-manifest.js";

/** Outside common dev 3000-3099 (product FE/BE slots, legacy harness). */
const DEFAULT_DAEMON_PORT_BASE = 31670;
const DEFAULT_DAEMON_PORT_RANGE = 90;

/** Stable short id for a workspace root (tmux session suffix, port offset). */
export function workspaceScopeId(workspace: string, length = 6): string {
  const resolved = path.resolve(workspace);
  return createHash("sha256").update(resolved).digest("hex").slice(0, length);
}

/** Tmux session name: `mesh-a3f91c` when scope=workspace, else yaml `session.name`. */
export function resolveSessionName(profile: MeshProfile, workspace: string): string {
  const base = profile.session.name;
  const scope = profile.session.scope ?? "workspace";
  if (scope === "global") return base;
  const len = profile.session.idLength ?? 6;
  return `${base}-${workspaceScopeId(workspace, len)}`;
}

/** Inbox HTTP port — unique per workspace when portScope=workspace. */
export function resolveDaemonPort(profile: MeshProfile, workspace: string): number {
  const daemon = profile.daemon;
  const scope = daemon?.portScope ?? "workspace";
  if (scope === "profile") {
    return daemon?.port ?? DEFAULT_DAEMON_PORT_BASE;
  }
  const base = daemon?.portBase ?? DEFAULT_DAEMON_PORT_BASE;
  const range = daemon?.portRange ?? DEFAULT_DAEMON_PORT_RANGE;
  const offset = parseInt(workspaceScopeId(workspace, 8), 16) % range;
  return base + offset;
}

export function resolveDataRoot(profile: MeshProfile, workspace: string): string {
  const rel = profile.data?.root ?? "runtime";
  const scope = profile.paths?.scope ?? "profile";
  if (scope === "workspace") return resolveFromWorkspace(workspace, rel);
  return rel;
}

export interface MeshRuntimePaths {
  dataRoot: string;
  daemonDir: string;
  sqlitePath: string;
  storageBackend: StorageBackend;
  inboxJsonl: string;
  peerJsonl: string;
  checkbackJsonl: string;
  ackJsonl: string;
  targetJsonl: string;
  paneOpsJsonl: string;
  callsJsonl: string;
  /** Persisted operator notify rows (survive inbox restart / reboot). */
  notificationsJsonl: string;
  /** Persisted act cards + tokens for Yes/No restore after daemon bounce. */
  actCardsJsonl: string;
  meshInboxMeta: string;
  meshInboxStop: string;
  meshInboxLog: string;
  coldStartState: string;
  ppaState: string;
  wifiProbeLock: string;
  minisJson: string;
  miniDone: string;
  miniManifest: string;
  gateQueue: string;
  /** Directory for terminal-pool job stdout/stderr logs. */
  tpJobsDir: string;
}

export function meshRuntimePaths(loaded: LoadedProfile): MeshRuntimePaths {
  const resolved = buildResolvedPaths(loaded);
  const { dataRoot, daemonDir, sqlitePath, storageBackend } = resolved;
  return {
    dataRoot,
    daemonDir,
    sqlitePath,
    storageBackend,
    inboxJsonl: path.join(daemonDir, "INBOX.jsonl"),
    peerJsonl: path.join(daemonDir, "PEER.jsonl"),
    checkbackJsonl: path.join(daemonDir, "CHECKBACK.jsonl"),
    ackJsonl: path.join(daemonDir, "ACK.jsonl"),
    targetJsonl: path.join(daemonDir, "TARGET.jsonl"),
    paneOpsJsonl: path.join(daemonDir, "PANE_OPS.jsonl"),
    callsJsonl: path.join(daemonDir, "CALLS.jsonl"),
    notificationsJsonl: path.join(daemonDir, "NOTIFICATIONS.jsonl"),
    actCardsJsonl: path.join(daemonDir, "ACT-CARDS.jsonl"),
    meshInboxMeta: path.join(daemonDir, "mesh-inbox.json"),
    meshInboxStop: path.join(daemonDir, "mesh-inbox.stop"),
    meshInboxLog: path.join(daemonDir, "mesh-inbox.log"),
    coldStartState: path.join(daemonDir, "cold-start.json"),
    ppaState: path.join(daemonDir, "ppa-state.json"),
    wifiProbeLock: path.join(daemonDir, "cpe-wifi-probe.lock"),
    minisJson: path.join(dataRoot, "minis.json"),
    miniDone: path.join(dataRoot, "MINI-DONE.md"),
    miniManifest: path.join(dataRoot, "mini-manifest.json"),
    gateQueue: path.join(dataRoot, "GATE-QUEUE.md"),
    tpJobsDir: path.join(daemonDir, "tp-jobs"),
  };
}

/** Workspace-relative path for agent-visible hints (whoami, checkback). */
export function runtimePathHint(workspace: string, absPath: string): string {
  const rel = path.relative(workspace, absPath);
  return rel && !rel.startsWith("..") ? rel : absPath;
}

export interface ResolvedConnectivityHooks {
  status?: string;
  up?: string;
  rotate?: string;
  smartRestart?: string;
  reset?: string;
}

/** Resolve hook scripts to absolute paths (profile hooks only — no driver branches). */
export function resolveConnectivityHooks(
  profile: MeshProfile,
  workspace: string,
): ResolvedConnectivityHooks | null {
  const conn = profile.connectivity;
  if (!conn?.enabled) return null;
  const rel = (p?: string) => {
    if (!p) return undefined;
    const abs = resolveFromWorkspace(workspace, p);
    return fs.existsSync(abs) ? abs : abs;
  };
  const hooks = conn.hooks;
  if (
    !hooks?.up &&
    !hooks?.rotate &&
    !hooks?.smartRestart &&
    !hooks?.status &&
    !hooks?.reset
  ) {
    return null;
  }
  return {
    status: rel(hooks.status),
    up: rel(hooks.up),
    rotate: rel(hooks.rotate),
    smartRestart: rel(hooks.smartRestart),
    reset: rel(hooks.reset),
  };
}

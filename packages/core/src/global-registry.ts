import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { LoadedProfile } from "./profile.js";
import { profilePaths } from "./profile.js";
import { SM_DIR } from "./dotdir.js";

export const GLOBAL_REGISTRY_VERSION = 1;

export interface GlobalSessionEntry {
  /** Stable id — workspace scope hash. */
  id: string;
  label: string;
  profilePath: string;
  workspace: string;
  workspaceId: string;
  sessionName: string;
  daemonPort: number;
  lastSeen: string;
}

export interface GlobalRegistry {
  version: number;
  sessions: GlobalSessionEntry[];
}

export function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "seatmesh");
}

export function globalRegistryPath(): string {
  return path.join(globalConfigDir(), "sessions.json");
}

function emptyRegistry(): GlobalRegistry {
  return { version: GLOBAL_REGISTRY_VERSION, sessions: [] };
}

export function readGlobalRegistry(): GlobalRegistry {
  const file = globalRegistryPath();
  if (!fs.existsSync(file)) return emptyRegistry();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as GlobalRegistry;
    if (!raw || !Array.isArray(raw.sessions)) return emptyRegistry();
    return { version: GLOBAL_REGISTRY_VERSION, sessions: raw.sessions };
  } catch {
    return emptyRegistry();
  }
}

async function withRegistryLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const file = globalRegistryPath();
  fs.mkdirSync(globalConfigDir(), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${JSON.stringify(emptyRegistry(), null, 2)}\n`);
  }
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(file, { retries: { retries: 5, minTimeout: 20 } });
    return await fn();
  } finally {
    if (release) await release();
  }
}

function writeGlobalRegistrySync(reg: GlobalRegistry): void {
  const file = globalRegistryPath();
  fs.mkdirSync(globalConfigDir(), { recursive: true });
  const sorted = {
    ...reg,
    sessions: [...reg.sessions].sort(
      (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
    ),
  };
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Project `.sm/` profiles only — not bundled minimal fallback. */
export function isProjectProfilePath(profilePath: string): boolean {
  const norm = profilePath.split(path.sep).join("/");
  return norm.includes(`/${SM_DIR}/`) || norm.endsWith(`/${SM_DIR}/mesh.config.yaml`);
}

export function sessionLabel(loaded: LoadedProfile): string {
  return loaded.profile.name || path.basename(loaded.workspace);
}

export function entryFromLoaded(loaded: LoadedProfile): GlobalSessionEntry {
  const paths = profilePaths(loaded);
  return {
    id: loaded.workspaceId,
    label: sessionLabel(loaded),
    profilePath: loaded.profilePath,
    workspace: loaded.workspace,
    workspaceId: loaded.workspaceId,
    sessionName: loaded.sessionName,
    daemonPort: paths.daemonPort,
    lastSeen: new Date().toISOString(),
  };
}

export async function upsertGlobalSession(
  loaded: LoadedProfile,
): Promise<GlobalSessionEntry | null> {
  if (!isProjectProfilePath(loaded.profilePath)) return null;
  const entry = entryFromLoaded(loaded);
  await withRegistryLock(() => {
    const reg = readGlobalRegistry();
    const idx = reg.sessions.findIndex(
      (s) => s.id === entry.id || s.profilePath === entry.profilePath,
    );
    if (idx >= 0) {
      reg.sessions[idx] = { ...reg.sessions[idx]!, ...entry };
    } else {
      reg.sessions.push(entry);
    }
    writeGlobalRegistrySync(reg);
  });
  return entry;
}

export async function forgetGlobalSession(idOrPath: string): Promise<boolean> {
  let removed = false;
  await withRegistryLock(() => {
    const reg = readGlobalRegistry();
    const key = idOrPath.trim();
    const next = reg.sessions.filter((s) => {
      const hit =
        s.id === key ||
        s.profilePath === key ||
        path.resolve(s.profilePath) === path.resolve(key) ||
        s.workspace === key ||
        path.resolve(s.workspace) === path.resolve(key);
      if (hit) removed = true;
      return !hit;
    });
    writeGlobalRegistrySync({ ...reg, sessions: next });
  });
  return removed;
}

export function findGlobalSession(
  reg: GlobalRegistry,
  idOrPath: string,
): GlobalSessionEntry | undefined {
  const key = idOrPath.trim();
  return reg.sessions.find(
    (s) =>
      s.id === key ||
      s.profilePath === key ||
      path.resolve(s.profilePath) === path.resolve(key) ||
      s.sessionName === key ||
      s.workspace === key ||
      path.resolve(s.workspace) === path.resolve(key),
  );
}

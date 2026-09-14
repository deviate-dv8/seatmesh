import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "../profile/profile.js";

export const PATHS_MANIFEST = "paths.json";

export type PathsScope = "profile" | "workspace";
export type StorageBackend = "sqlite" | "jsonl";

export interface ResolvedPaths {
  dataRoot: string;
  daemonDir: string;
  seatsRoot: string;
  meshAgentsJson: string;
  agentsJson: string;
  chatRoomsRoot: string;
  chatFilesRoot: string;
  rolesDir: string;
  contractsDir: string;
  sqlitePath: string;
  storageBackend: StorageBackend;
}

export interface PathsManifestDoc {
  version: number;
  profileDir: string;
  workspace: string;
  pathsScope: PathsScope;
  paths: Record<string, string>;
}

/** Resolve a harness path from mesh.config (profileDir-relative by default). */
export function resolveHarnessPath(loaded: LoadedProfile, rel: string): string {
  const scope = loaded.profile.paths?.scope ?? "profile";
  let raw = rel.trim();
  if (path.isAbsolute(raw)) return path.normalize(raw);
  // Init templates used to prefix `.sm/` even with paths.scope=profile (profileDir
  // is already `.sm` / `.sm-<id>`), which produced `.sm/.sm/agents.json`. Strip once.
  if (scope === "profile") {
    const base = path.basename(loaded.profileDir);
    if (base === ".sm" || base.startsWith(".sm-")) {
      if (raw === ".sm" || raw === base) raw = ".";
      else if (raw.startsWith(".sm/") || raw.startsWith(`${base}/`)) {
        raw = raw.slice(raw.indexOf("/") + 1);
      }
    }
  }
  if (scope === "workspace") {
    return path.normalize(path.resolve(loaded.workspace, raw));
  }
  return path.normalize(path.resolve(loaded.profileDir, raw === "." ? "" : raw));
}

export function pathsScope(loaded: LoadedProfile): PathsScope {
  return loaded.profile.paths?.scope ?? "profile";
}

export function storageBackend(loaded: LoadedProfile): StorageBackend {
  return loaded.profile.storage?.backend ?? "sqlite";
}

export function buildResolvedPaths(loaded: LoadedProfile): ResolvedPaths {
  const { profile } = loaded;
  const dataRoot = resolveHarnessPath(loaded, profile.data?.root ?? "runtime");
  const sqliteRel = profile.storage?.sqlite?.path ?? "runtime/mesh.sqlite";
  return {
    dataRoot,
    daemonDir: path.join(dataRoot, "daemon"),
    seatsRoot: resolveHarnessPath(loaded, profile.seats.root),
    meshAgentsJson: resolveHarnessPath(loaded, profile.state.meshAgentsJson),
    agentsJson: resolveHarnessPath(loaded, profile.state.agentsJson),
    chatRoomsRoot: resolveHarnessPath(loaded, profile.chatRooms?.root ?? "chat-rooms"),
    chatFilesRoot: resolveHarnessPath(loaded, profile.chatFiles?.root ?? "chat-files"),
    rolesDir: path.resolve(loaded.profileDir, profile.roles.dir),
    contractsDir: path.resolve(loaded.profileDir, "contracts"),
    sqlitePath: resolveHarnessPath(loaded, sqliteRel),
    storageBackend: storageBackend(loaded),
  };
}

function workspaceRelativeHint(workspace: string, abs: string): string {
  const rel = path.relative(workspace, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

/** Write `.sm/paths.json` (workspace-relative path hints for agents). */
export function writePathsManifest(loaded: LoadedProfile): string {
  const resolved = buildResolvedPaths(loaded);
  const outPath = path.join(loaded.profileDir, PATHS_MANIFEST);
  const doc: PathsManifestDoc = {
    version: 1,
    profileDir: loaded.profileDir,
    workspace: loaded.workspace,
    pathsScope: pathsScope(loaded),
    paths: {
      dataRoot: workspaceRelativeHint(loaded.workspace, resolved.dataRoot),
      daemonDir: workspaceRelativeHint(loaded.workspace, resolved.daemonDir),
      seatsRoot: workspaceRelativeHint(loaded.workspace, resolved.seatsRoot),
      meshAgentsJson: workspaceRelativeHint(loaded.workspace, resolved.meshAgentsJson),
      agentsJson: workspaceRelativeHint(loaded.workspace, resolved.agentsJson),
      chatRoomsRoot: workspaceRelativeHint(loaded.workspace, resolved.chatRoomsRoot),
      chatFilesRoot: workspaceRelativeHint(loaded.workspace, resolved.chatFilesRoot),
      rolesDir: workspaceRelativeHint(loaded.workspace, resolved.rolesDir),
      contractsDir: workspaceRelativeHint(loaded.workspace, resolved.contractsDir),
      sqlitePath: workspaceRelativeHint(loaded.workspace, resolved.sqlitePath),
      storageBackend: resolved.storageBackend,
    },
  };
  fs.mkdirSync(loaded.profileDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
  return outPath;
}

/** Refuse harness paths outside profileDir when scope=profile (safety guard). */
export function assertHarnessUnderDotdir(loaded: LoadedProfile, absPath: string, label: string): void {
  if (pathsScope(loaded) !== "profile") return;
  const rel = path.relative(loaded.profileDir, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `harness path ${label} must live under profile dir ${loaded.profileDir} (got ${absPath})`,
    );
  }
}

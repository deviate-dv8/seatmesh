import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { seatMeshPackageRoot } from "../paths/engine-paths.js";
import { findDotSmConfig } from "../runtime/dotdir.js";
import { MeshProfileSchema, type MeshProfile } from "../schema/profile.js";
import { resolveWorkspace, resolveFromProfile } from "../paths/paths.js";
import {
  buildResolvedPaths,
  writePathsManifest,
  assertHarnessUnderDotdir,
} from "../paths/paths-manifest.js";
import {
  meshRuntimePaths,
  resolveDaemonPort,
  resolveSessionName,
  workspaceScopeId,
  type MeshRuntimePaths,
} from "../paths/runtime-paths.js";
import {
  primaryManagerColumn,
  primarySecretaryColumn,
  seatDirSegment,
} from "../schema/seat-kind.js";

export interface LoadedProfile {
  profile: MeshProfile;
  profileDir: string;
  profilePath: string;
  workspace: string;
  /** Short hash of resolved workspace path. */
  workspaceId: string;
  /** Resolved tmux session name (may include workspace suffix). */
  sessionName: string;
}

export type { MeshRuntimePaths };
export {
  meshRuntimePaths,
  resolveDaemonPort,
  resolveSessionName,
  workspaceScopeId,
  resolveConnectivityHooks,
  runtimePathHint,
} from "../paths/runtime-paths.js";

export { seatMeshPackageRoot, resolveDaemonScript } from "../paths/engine-paths.js";

/** Default profile: workspace `.sm/` when present, else bundled minimal. No flags required. */
export function defaultProfilePath(): string {
  const root = seatMeshPackageRoot();
  const candidates = [path.join(root, "profiles/minimal/mesh.config.yaml")];
  for (const cfg of candidates) {
    if (fs.existsSync(cfg)) return cfg;
  }
  throw new Error(`no default profile under ${root}/profiles/`);
}

export function findProfilePath(explicit?: string, searchFrom = process.cwd()): string {
  if (explicit) {
    const p = path.resolve(explicit);
    if (fs.statSync(p).isDirectory()) {
      const dotCfg = path.join(p, ".sm", "mesh.config.yaml");
      const cfg = fs.existsSync(dotCfg) ? dotCfg : path.join(p, "mesh.config.yaml");
      if (!fs.existsSync(cfg)) {
        throw new Error(
          `profile directory missing mesh.config.yaml (or .sm/mesh.config.yaml): ${p}`,
        );
      }
      return cfg;
    }
    if (!fs.existsSync(p)) throw new Error(`profile not found: ${p}`);
    return p;
  }

  const dotCfg = findDotSmConfig(searchFrom);
  if (dotCfg) return dotCfg;

  return defaultProfilePath();
}

export function loadProfile(explicit?: string): LoadedProfile {
  const profilePath = findProfilePath(explicit);
  const profileDir = path.dirname(profilePath);
  const raw = YAML.parse(fs.readFileSync(profilePath, "utf8"));
  const profile = MeshProfileSchema.parse(raw);
  const workspace = resolveWorkspace(profile.workspace, profileDir);
  const workspaceId = workspaceScopeId(workspace);
  const sessionName = resolveSessionName(profile, workspace);

  const loaded = { profile, profileDir, profilePath, workspace, workspaceId, sessionName };
  try {
    writePathsManifest(loaded);
  } catch {
    /* non-fatal on read-only profile dir */
  }
  return loaded;
}

export function profilePaths(loaded: LoadedProfile) {
  const { profile } = loaded;
  const resolved = buildResolvedPaths(loaded);
  const rt = meshRuntimePaths(loaded);
  const dirs = profile.seats.dirs;
  const primaryMgr = primaryManagerColumn(profile.layout);
  const primarySec = primarySecretaryColumn(profile.layout);
  for (const [label, abs] of [
    ["dataRoot", resolved.dataRoot],
    ["daemonDir", resolved.daemonDir],
    ["seatsRoot", resolved.seatsRoot],
    ["meshAgentsJson", resolved.meshAgentsJson],
    ["chatRoomsRoot", resolved.chatRoomsRoot],
    ["chatFilesRoot", resolved.chatFilesRoot],
    ["sqlitePath", resolved.sqlitePath],
  ] as const) {
    assertHarnessUnderDotdir(loaded, abs, label);
  }
  return {
    seatsRoot: resolved.seatsRoot,
    agentsJson: resolved.agentsJson,
    meshAgentsJson: resolved.meshAgentsJson,
    chatRoomsRoot: resolved.chatRoomsRoot,
    chatFilesRoot: resolved.chatFilesRoot,
    rolesDir: resolved.rolesDir,
    contractsDir: resolved.contractsDir,
    managerDir: path.join(resolved.seatsRoot, seatDirSegment(dirs, primaryMgr)),
    secretaryDir: path.join(resolved.seatsRoot, seatDirSegment(dirs, primarySec)),
    daemonPort: resolveDaemonPort(profile, loaded.workspace),
    pathsManifest: path.join(loaded.profileDir, "paths.json"),
    ...rt,
  };
}

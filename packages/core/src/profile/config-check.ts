import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { findProfilePath } from "./profile.js";
import { resolveFromProfile, resolveWorkspace } from "../paths/paths.js";
import { buildResolvedPaths } from "../paths/paths-manifest.js";
import { MeshProfileSchema, type MeshProfile } from "../schema/profile.js";
import { resolveDaemonPort } from "../paths/runtime-paths.js";

export type ConfigCheckSeverity = "error" | "warn";

export interface ConfigCheckIssue {
  id: string;
  severity: ConfigCheckSeverity;
  /** YAML key path, e.g. daemon.pollMs */
  field?: string;
  message: string;
}

export interface ConfigCheckResult {
  ok: boolean;
  profilePath: string;
  profileDir: string;
  workspace?: string;
  daemonPort?: number;
  remoteAliases: string[];
  issues: ConfigCheckIssue[];
}

function issue(
  id: string,
  severity: ConfigCheckSeverity,
  message: string,
  field?: string,
): ConfigCheckIssue {
  return { id, severity, message, field };
}

function resolveRemoteProfile(remoteProfile: string, profileDir: string): string {
  const raw = remoteProfile.trim();
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.normalize(path.resolve(profileDir, raw));
}

function remoteConfigPath(profileDirOrFile: string): string {
  const p = profileDirOrFile.trim();
  if (p.endsWith("mesh.config.yaml")) return p;
  const dotSm = path.join(p, ".sm", "mesh.config.yaml");
  if (fs.existsSync(dotSm)) return dotSm;
  const direct = path.join(p, "mesh.config.yaml");
  if (fs.existsSync(direct)) return direct;
  return dotSm;
}

function checkResolvedProfile(
  result: ConfigCheckResult,
  profile: MeshProfile,
  profileDir: string,
): void {
  const workspace = resolveWorkspace(profile.workspace, profileDir);
  result.workspace = workspace;

  if (!fs.existsSync(workspace)) {
    result.issues.push(
      issue("workspace-missing", "error", `workspace path not found: ${workspace}`, "workspace"),
    );
  } else {
    try {
      if (!fs.statSync(workspace).isDirectory()) {
        result.issues.push(
          issue("workspace-not-dir", "error", `workspace is not a directory: ${workspace}`, "workspace"),
        );
      }
    } catch {
      result.issues.push(
        issue("workspace-stat", "error", `cannot stat workspace: ${workspace}`, "workspace"),
      );
    }
  }

  const rolesDir = resolveFromProfile(profileDir, profile.roles?.dir ?? "roles");
  if (!fs.existsSync(rolesDir)) {
    result.issues.push(
      issue("roles-dir-missing", "warn", `roles dir missing (run init/update): ${rolesDir}`, "roles.dir"),
    );
  }

  const debounceMs = profile.daemon?.injectDebounceMs ?? 2500;
  const debounceMax = profile.daemon?.injectDebounceMaxMs ?? 8000;
  if (debounceMax < debounceMs) {
    result.issues.push(
      issue(
        "debounce-max",
        "error",
        `injectDebounceMaxMs (${debounceMax}) must be >= injectDebounceMs (${debounceMs})`,
        "daemon.injectDebounceMaxMs",
      ),
    );
  }

  try {
    result.daemonPort = resolveDaemonPort(profile, workspace);
  } catch (e) {
    result.issues.push(
      issue(
        "daemon-port",
        "error",
        e instanceof Error ? e.message : String(e),
        "daemon.port",
      ),
    );
  }

  const remotes = profile.remotes ?? {};
  for (const [alias, row] of Object.entries(remotes)) {
    result.remoteAliases.push(alias);
    const raw = row?.profile?.trim();
    if (!raw) {
      result.issues.push(
        issue(`remote-${alias}-empty`, "error", `remotes.${alias}.profile is empty`, `remotes.${alias}.profile`),
      );
      continue;
    }
    const resolved = resolveRemoteProfile(raw, profileDir);
    const cfg = remoteConfigPath(resolved);
    if (!fs.existsSync(cfg)) {
      result.issues.push(
        issue(
          `remote-${alias}-missing`,
          "warn",
          `remotes.${alias}.profile not found: ${raw} (resolved ${cfg})`,
          `remotes.${alias}.profile`,
        ),
      );
      continue;
    }
    try {
      const foreignRaw = YAML.parse(fs.readFileSync(cfg, "utf8"));
      const foreign = MeshProfileSchema.safeParse(foreignRaw);
      if (!foreign.success) {
        const msg = foreign.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        result.issues.push(
          issue(
            `remote-${alias}-invalid`,
            "warn",
            `remotes.${alias} foreign config invalid (${cfg}): ${msg}`,
            `remotes.${alias}.profile`,
          ),
        );
      }
    } catch (e) {
      result.issues.push(
        issue(
          `remote-${alias}-parse`,
          "warn",
          `remotes.${alias} foreign config unreadable: ${e instanceof Error ? e.message : String(e)}`,
          `remotes.${alias}.profile`,
        ),
      );
    }
  }

  try {
    buildResolvedPaths({
      profile,
      profileDir,
      profilePath: result.profilePath,
      workspace,
      workspaceId: "check",
      sessionName: profile.session?.name ?? "mesh",
    });
  } catch (e) {
    result.issues.push(
      issue(
        "paths-manifest",
        "error",
        e instanceof Error ? e.message : String(e),
        "paths",
      ),
    );
  }
}

/** Validate mesh.config.yaml — schema + workspace/remotes/paths (no write). */
export function checkMeshConfig(explicitProfile?: string): ConfigCheckResult {
  const profilePath = findProfilePath(explicitProfile);
  const profileDir = path.dirname(profilePath);
  const result: ConfigCheckResult = {
    ok: false,
    profilePath,
    profileDir,
    remoteAliases: [],
    issues: [],
  };

  if (!fs.existsSync(profilePath)) {
    result.issues.push(
      issue("missing", "error", `profile not found: ${profilePath}`),
    );
    return result;
  }

  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (e) {
    result.issues.push(
      issue(
        "yaml-syntax",
        "error",
        `YAML parse failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    return result;
  }

  if (!raw || typeof raw !== "object") {
    result.issues.push(issue("yaml-empty", "error", "config file is empty or not a mapping"));
    return result;
  }

  const parsed = MeshProfileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 12)) {
      const field = i.path.length ? i.path.join(".") : undefined;
      result.issues.push(
        issue(`schema-${field ?? "root"}`, "error", i.message, field),
      );
    }
    if (parsed.error.issues.length > 12) {
      result.issues.push(
        issue(
          "schema-more",
          "error",
          `…and ${parsed.error.issues.length - 12} more schema issue(s)`,
        ),
      );
    }
    return result;
  }

  checkResolvedProfile(result, parsed.data, profileDir);
  result.ok = !result.issues.some((i) => i.severity === "error");
  return result;
}

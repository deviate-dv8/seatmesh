/**
 * Role pack versioning — locked `_vendor` templates + up/down migrators.
 * Pack version is independent of CLI patch; bumps with role schema releases (1.1.x).
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const ROLE_PACK_FILENAME = "ROLE_PACK.json";
export const CURRENT_ROLE_PACK_VERSION = "1.1.0";

export const ROLE_KINDS = ["common", "manager", "secretary", "worker", "mini"] as const;
export type RoleKindName = (typeof ROLE_KINDS)[number];

export interface RolePackManifest {
  version: string;
  /** Human notes for this pack. */
  notes?: string;
  /** Section names that are engine-owned in every vendor role yaml. */
  locked_sections?: string[];
  kinds?: string[];
}

export interface RolePackStatus {
  rolesDir: string;
  installed: string | null;
  target: string;
  needsMigrate: boolean;
  hasVendor: boolean;
  hasLegacyFlat: boolean;
  extendFiles: string[];
  missingVendor: string[];
  missingDocs: string[];
}

export function vendorRolesDir(rolesDir: string): string {
  return path.join(rolesDir, "_vendor");
}

export function rolePackManifestPath(rolesDir: string): string {
  return path.join(vendorRolesDir(rolesDir), ROLE_PACK_FILENAME);
}

export function roleExtendPath(rolesDir: string, kind: string): string {
  return path.join(rolesDir, `${kind}.extend.yaml`);
}

export function roleLegacyFlatPath(rolesDir: string, kind: string): string {
  return path.join(rolesDir, `${kind}.yaml`);
}

export function roleVendorPath(rolesDir: string, kind: string): string {
  return path.join(vendorRolesDir(rolesDir), `${kind}.yaml`);
}

export function roleVendorDocsDir(rolesDir: string): string {
  return path.join(vendorRolesDir(rolesDir), "docs");
}

export function readRolePackManifest(rolesDir: string): RolePackManifest | null {
  const p = rolePackManifestPath(rolesDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as RolePackManifest;
  } catch {
    return null;
  }
}

export function writeRolePackManifest(
  rolesDir: string,
  manifest: RolePackManifest,
  dryRun = false,
): void {
  const dest = rolePackManifestPath(rolesDir);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function installedRolePackVersion(rolesDir: string): string | null {
  return readRolePackManifest(rolesDir)?.version ?? null;
}

/** Compare dotted versions: -1 if a<b, 0 equal, 1 if a>b. */
export function compareRolePackVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

export function inspectRolePack(
  rolesDir: string,
  target = CURRENT_ROLE_PACK_VERSION,
): RolePackStatus {
  const installed = installedRolePackVersion(rolesDir);
  const vendor = vendorRolesDir(rolesDir);
  const hasVendor = fs.existsSync(vendor);
  const missingVendor: string[] = [];
  const missingDocs: string[] = [];
  let hasLegacyFlat = false;
  const extendFiles: string[] = [];

  for (const kind of ROLE_KINDS) {
    if (!fs.existsSync(roleVendorPath(rolesDir, kind))) missingVendor.push(kind);
    if (fs.existsSync(roleLegacyFlatPath(rolesDir, kind))) hasLegacyFlat = true;
    if (fs.existsSync(roleExtendPath(rolesDir, kind))) {
      extendFiles.push(`${kind}.extend.yaml`);
    }
  }
  const docsDir = roleVendorDocsDir(rolesDir);
  for (const kind of [...ROLE_KINDS, "EXTEND"] as const) {
    const name = kind === "EXTEND" ? "EXTEND.md" : `${kind}.md`;
    if (!fs.existsSync(path.join(docsDir, name))) missingDocs.push(name);
  }

  const needsMigrate =
    !installed ||
    compareRolePackVersion(installed, target) !== 0 ||
    missingVendor.length > 0 ||
    (hasLegacyFlat && extendFiles.length === 0);

  return {
    rolesDir,
    installed,
    target,
    needsMigrate,
    hasVendor,
    hasLegacyFlat,
    extendFiles,
    missingVendor,
    missingDocs,
  };
}

/** Parse locked section list from a vendor role yaml body. */
export function lockedSectionsFromYaml(raw: Record<string, unknown>): string[] {
  const locked = raw.locked;
  if (Array.isArray(locked)) {
    return locked.map((x) => String(x).trim()).filter(Boolean);
  }
  if (locked && typeof locked === "object" && Array.isArray((locked as { sections?: unknown }).sections)) {
    return ((locked as { sections: unknown[] }).sections)
      .map((x) => String(x).trim())
      .filter(Boolean);
  }
  return [];
}

/** Strip engine-only keys before merge into RoleIndex. */
export function stripRoleMetaKeys(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const {
    locked: _l,
    role_pack: _rp,
    schema_version: _sv,
    ...rest
  } = raw;
  return rest;
}

export function parseRoleYamlFile(filePath: string): Record<string, unknown> {
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8"));
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, unknown>;
}

/** Default locked sections for pack 1.1.0 when yaml omits `locked:`. */
export const DEFAULT_LOCKED_SECTIONS_1_1 = [
  "banner",
  "read_first",
  "policies",
] as const;

export function extendStubBody(kind: string, packVersion: string): string {
  return `# USER — never overwritten by \`seatmesh update\` / role-pack migrate.
# Locked vendor sections (see roles/_vendor/${kind}.yaml \`locked:\`) keep engine entries.
# Append banners / read_first / files, or add new policy ids only.
# role_pack: ${packVersion}
#
# Example:
# banner:
#   - "project=my hub note"
# policies:
#   - id: my_playbook
#     path: .agent/PLAYBOOK.md
`;
}

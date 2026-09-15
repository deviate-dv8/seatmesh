import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { seatKindFromId } from "../schema/seat-kind.js";
import {
  DEFAULT_LOCKED_SECTIONS_1_1,
  lockedSectionsFromYaml,
  roleExtendPath,
  roleLegacyFlatPath,
  roleVendorPath,
  stripRoleMetaKeys,
  vendorRolesDir,
} from "./role-pack.js";

export interface RoleIndexEntry {
  path: string;
  note?: string;
}

export interface RolePolicy {
  id: string;
  text?: string;
  path?: string;
  rule?: string;
  cmd?: string;
}

export interface RoleAllowDeny {
  allow?: string[];
  deny?: string[];
}

export interface RoleIndex {
  kind: string;
  /** Parent role file name (no .yaml) — merged before this file. */
  extends?: string;
  /** Printed first on whoami (patterns.md / ONE-PATH). */
  banner?: string[];
  read_first?: RoleIndexEntry[];
  policies?: RolePolicy[];
  files?: string[];
  inject?: string[];
  vars?: Record<string, string>;
  /** Comms + builtin command guards (AGENT-FUNC-GUARDS.md / ROLE-YAML.md). */
  guards?: RoleAllowDeny;
  /** Attached-external (seatmesh func) allow/deny per role. */
  funcs?: RoleAllowDeny;
  /** Engine-owned sections from vendor (informational; set on load). */
  locked?: string[];
}

type RoleYaml = Partial<RoleIndex> & {
  extends?: string;
  kind?: string;
  locked?: unknown;
  role_pack?: string;
};

/** Deny accumulates from base; child role's own allow list wins over base's allow. */
function mergeAllowDeny(base?: RoleAllowDeny, role?: RoleAllowDeny): RoleAllowDeny | undefined {
  if (!base && !role) return undefined;
  const deny = [...new Set([...(base?.deny ?? []), ...(role?.deny ?? [])])];
  const allow = role?.allow ?? base?.allow;
  return { ...(allow ? { allow } : {}), ...(deny.length ? { deny } : {}) };
}

function mergeRoleIndex(base: Partial<RoleIndex>, role: RoleIndex): RoleIndex {
  const readFirst = [...(base.read_first ?? []), ...(role.read_first ?? [])];
  const seen = new Set<string>();
  const dedupedReadFirst = readFirst.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
  const policyById = new Map<string, RolePolicy>();
  for (const p of [...(base.policies ?? []), ...(role.policies ?? [])]) {
    policyById.set(p.id, p);
  }
  const policies = [...policyById.values()];
  return {
    ...role,
    kind: role.kind ?? base.kind ?? "worker",
    banner: [...(base.banner ?? []), ...(role.banner ?? [])],
    read_first: dedupedReadFirst,
    policies,
    files: [...new Set([...(base.files ?? []), ...(role.files ?? [])])],
    inject: [...(base.inject ?? []), ...(role.inject ?? [])],
    vars: { ...(base.vars ?? {}), ...(role.vars ?? {}) },
    guards: mergeAllowDeny(base.guards, role.guards),
    funcs: mergeAllowDeny(base.funcs, role.funcs),
    locked: role.locked ?? base.locked,
  };
}

/**
 * Merge user extend onto vendor with locked-section rules:
 * - locked `policies`: vendor ids win; extend may only add new ids
 * - locked `banner` / `read_first` / `files` / `inject`: union (append); extend cannot clear
 * - locked `guards`/`funcs`: deny accumulates; allow from extend only if section unlocked
 * - unlocked sections: child wins (same as mergeRoleIndex)
 */
export function mergeExtendRespectingLocked(
  vendor: RoleIndex,
  extend: Partial<RoleIndex>,
  lockedSections: string[],
): RoleIndex {
  const locked = new Set(lockedSections.map((s) => s.trim()).filter(Boolean));
  const policyById = new Map<string, RolePolicy>();
  for (const p of vendor.policies ?? []) policyById.set(p.id, p);
  for (const p of extend.policies ?? []) {
    if (locked.has("policies") && policyById.has(p.id)) continue;
    policyById.set(p.id, p);
  }

  const readFirst = [
    ...(vendor.read_first ?? []),
    ...(extend.read_first ?? []),
  ].filter((item, _i, arr) => {
    // dedupe by path, first wins (vendor)
    return arr.findIndex((x) => x.path === item.path) === arr.indexOf(item);
  });
  const banners = [...(vendor.banner ?? []), ...(extend.banner ?? [])];
  const files = [...new Set([...(vendor.files ?? []), ...(extend.files ?? [])])];
  const inject = [...(vendor.inject ?? []), ...(extend.inject ?? [])];

  let guards = vendor.guards;
  let funcs = vendor.funcs;
  if (extend.guards) {
    guards = locked.has("guards")
      ? mergeAllowDeny(vendor.guards, { deny: extend.guards.deny })
      : mergeAllowDeny(vendor.guards, extend.guards);
  }
  if (extend.funcs) {
    funcs = locked.has("funcs")
      ? mergeAllowDeny(vendor.funcs, { deny: extend.funcs.deny })
      : mergeAllowDeny(vendor.funcs, extend.funcs);
  }

  return {
    kind: extend.kind ?? vendor.kind,
    extends: extend.extends ?? vendor.extends,
    banner: banners,
    read_first: readFirst,
    policies: [...policyById.values()],
    files,
    inject,
    vars: { ...(vendor.vars ?? {}), ...(extend.vars ?? {}) },
    guards,
    funcs,
    locked: lockedSections,
  };
}

/**
 * True when `id` is usable for this merged role: explicit deny always wins;
 * otherwise an explicit allow list restricts to just that list; with neither,
 * default to allowed (profile-level `external.default` is the real gate for funcs).
 */
export function roleAllows(rule: RoleAllowDeny | undefined, id: string): boolean {
  if (!rule) return true;
  if (rule.deny?.includes(id)) return false;
  if (rule.allow?.length) return rule.allow.includes(id);
  return true;
}

/** Deprecated alias: prefer "manager" not "master" for the coordinator pane. */
function normalizeRoleKind(kind: string): string {
  return kind === "master" ? "manager" : kind;
}

function columnOverlayPath(rolesDir: string, columnId: string): string {
  return path.join(rolesDir, "columns", `${columnId}.yaml`);
}

function toRoleIndex(name: string, raw: RoleYaml): RoleIndex {
  const cleaned = stripRoleMetaKeys(raw as Record<string, unknown>) as RoleYaml;
  const locked = lockedSectionsFromYaml(raw as Record<string, unknown>);
  return {
    kind: cleaned.kind ?? name,
    extends: cleaned.extends,
    banner: cleaned.banner,
    read_first: cleaned.read_first,
    policies: cleaned.policies,
    files: cleaned.files,
    inject: cleaned.inject,
    vars: cleaned.vars,
    guards: cleaned.guards,
    funcs: cleaned.funcs,
    locked: locked.length ? locked : undefined,
  };
}

/**
 * Resolve which yaml files define a role kind:
 * 1. `_vendor/<name>.yaml` + optional `<name>.extend.yaml` (1.1+)
 * 2. legacy flat `<name>.yaml` (1.0)
 */
export function resolveRoleSources(
  rolesDir: string,
  name: string,
): { vendor?: string; extend?: string; legacy?: string; mode: "vendor+extend" | "legacy" | "missing" } {
  const vendor = roleVendorPath(rolesDir, name);
  const extend = roleExtendPath(rolesDir, name);
  const legacy = roleLegacyFlatPath(rolesDir, name);
  if (fs.existsSync(vendor)) {
    return {
      vendor,
      extend: fs.existsSync(extend) ? extend : undefined,
      mode: "vendor+extend",
    };
  }
  if (fs.existsSync(legacy)) {
    return { legacy, mode: "legacy" };
  }
  // extend-only is invalid without vendor
  return { mode: "missing" };
}

function loadYamlRole(filePath: string, name: string): RoleIndex {
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as RoleYaml;
  return toRoleIndex(name, raw ?? {});
}

/** Load one role name: vendor(+extend) or legacy flat, then merge extends chain. */
function loadRoleFileChain(
  rolesDir: string,
  name: string,
  visiting: Set<string>,
  /** Explicit path for column overlays (user files under roles/columns/). */
  explicitPath?: string,
): RoleIndex {
  const key = explicitPath ?? `role:${name}`;
  if (visiting.has(key)) {
    throw new Error(`role extends cycle at ${key}`);
  }
  visiting.add(key);

  let self: RoleIndex;
  let lockedSections: string[] = [];

  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`role index missing: ${explicitPath}`);
    }
    self = loadYamlRole(explicitPath, name);
    lockedSections = self.locked ?? [];
  } else {
    const src = resolveRoleSources(rolesDir, name);
    if (src.mode === "missing") {
      throw new Error(
        `role index missing: ${roleVendorPath(rolesDir, name)} (or legacy ${roleLegacyFlatPath(rolesDir, name)})`,
      );
    }
    if (src.mode === "legacy") {
      self = loadYamlRole(src.legacy!, name);
      lockedSections = self.locked ?? [];
    } else {
      const vendor = loadYamlRole(src.vendor!, name);
      lockedSections =
        vendor.locked?.length
          ? vendor.locked
          : fs.existsSync(vendorRolesDir(rolesDir))
            ? [...DEFAULT_LOCKED_SECTIONS_1_1]
            : [];
      if (src.extend) {
        const ext = loadYamlRole(src.extend, name);
        self = mergeExtendRespectingLocked(vendor, ext, lockedSections);
      } else {
        self = { ...vendor, locked: lockedSections };
      }
    }
  }

  const extendsName = self.extends?.trim();
  let merged: RoleIndex = { ...self, kind: self.kind ?? name, locked: lockedSections };

  if (extendsName) {
    const parentNorm = normalizeRoleKind(extendsName);
    const parent = loadRoleFileChain(rolesDir, parentNorm, visiting);
    merged = mergeRoleIndex(parent, {
      ...merged,
      kind: self.kind ?? name,
      locked: lockedSections,
    });
  } else if (name === "common") {
    merged = mergeRoleIndex({}, { ...merged, kind: "common", locked: lockedSections });
  } else {
    const commonSrc = resolveRoleSources(rolesDir, "common");
    if (commonSrc.mode !== "missing") {
      const common = loadRoleFileChain(rolesDir, "common", visiting);
      merged = mergeRoleIndex(common, {
        ...merged,
        kind: self.kind ?? name,
        locked: lockedSections,
      });
    } else {
      merged = mergeRoleIndex({}, { ...merged, kind: self.kind ?? name, locked: lockedSections });
    }
  }

  visiting.delete(key);
  return merged;
}

/**
 * Pane column id -> merged role index.
 * 1. Seat kind file (`_vendor/manager.yaml` + `manager.extend.yaml`, or legacy flat)
 *    with optional `extends:` chain (+ implicit common).
 * 2. Optional column overlay `.sm/roles/columns/<columnId>.yaml` with `extends: manager` (etc.).
 * Never load `roles/<columnId>.yaml` as a kind — use `columns/<columnId>.yaml`.
 */
export function loadRoleIndex(rolesDir: string, paneRoleId: string): RoleIndex {
  const columnId = normalizeRoleKind(paneRoleId);
  const seatKind = seatKindFromId(columnId);
  const overlayPath = columnOverlayPath(rolesDir, columnId);
  if (columnId !== seatKind && fs.existsSync(overlayPath)) {
    const merged = loadRoleFileChain(rolesDir, columnId, new Set(), overlayPath);
    merged.kind = seatKind;
    return merged;
  }
  const merged = loadRoleFileChain(rolesDir, seatKind, new Set());
  merged.kind = seatKind;
  return merged;
}

function substituteVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function renderRoleIndex(
  index: RoleIndex,
  vars: Record<string, string> = {},
  opts: { skipBanner?: boolean; skipFiles?: boolean } = {},
): string {
  const lines: string[] = [];

  if (!opts.skipBanner) {
    for (const line of index.banner ?? []) {
      lines.push(substituteVars(line, vars));
    }
  }

  for (const item of index.read_first ?? []) {
    const p = substituteVars(item.path, vars);
    const note = item.note ? substituteVars(item.note, vars) : "";
    lines.push(`file=${p}${note ? ` | ${note}` : ""}`);
  }

  for (const pol of index.policies ?? []) {
    if (pol.path) {
      lines.push(
        `policy_${pol.id}=${substituteVars(pol.path, vars)}${pol.rule ? ` | ${substituteVars(pol.rule, vars)}` : ""}`,
      );
    } else if (pol.text) {
      lines.push(`policy_${pol.id}=${substituteVars(pol.text, vars)}`);
    } else if (pol.cmd) {
      lines.push(`policy_${pol.id}=${substituteVars(pol.cmd, vars)}`);
    }
  }

  if (!opts.skipFiles) {
    for (const f of index.files ?? []) {
      lines.push(`file=${substituteVars(f, vars)}`);
    }
  }

  for (const [k, v] of Object.entries(index.vars ?? {})) {
    lines.push(`${k}=${substituteVars(v, vars)}`);
  }

  for (const line of index.inject ?? []) {
    lines.push(`inject=${substituteVars(line, vars)}`);
  }

  return lines.join("\n");
}

export function validateRoleIndex(
  index: RoleIndex,
  workspace: string,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const check = (rel: string) => {
    const p = path.isAbsolute(rel) ? rel : path.resolve(workspace, rel);
    if (!fs.existsSync(p)) missing.push(rel);
  };

  for (const item of index.read_first ?? []) check(item.path);
  for (const pol of index.policies ?? []) {
    if (pol.path) check(pol.path);
  }
  for (const f of index.files ?? []) check(f);

  return { ok: missing.length === 0, missing };
}

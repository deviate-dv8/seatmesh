import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { seatKindFromId } from "../schema/seat-kind.js";

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
}

type RoleYaml = Partial<RoleIndex> & { extends?: string; kind?: string };

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

function roleYamlPath(rolesDir: string, name: string): string {
  return path.join(rolesDir, `${name}.yaml`);
}

function columnOverlayPath(rolesDir: string, columnId: string): string {
  return path.join(rolesDir, "columns", `${columnId}.yaml`);
}

/** Load one yaml file and merge its `extends` chain (child wins on conflicts). */
function loadRoleFileChain(
  rolesDir: string,
  name: string,
  filePath: string,
  visiting: Set<string>,
): RoleIndex {
  const key = `${filePath}`;
  if (visiting.has(key)) {
    throw new Error(`role extends cycle at ${filePath}`);
  }
  visiting.add(key);

  if (!fs.existsSync(filePath)) {
    throw new Error(`role index missing: ${filePath}`);
  }

  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as RoleYaml;
  const extendsName = raw.extends?.trim();
  let merged: RoleIndex = { kind: raw.kind ?? name };

  if (extendsName) {
    const parentNorm = normalizeRoleKind(extendsName);
    const parentPath = roleYamlPath(rolesDir, parentNorm);
    const parent = loadRoleFileChain(rolesDir, parentNorm, parentPath, visiting);
    merged = mergeRoleIndex(parent, { ...merged, ...stripExtends(raw), kind: raw.kind ?? name });
  } else if (name === "common") {
    merged = mergeRoleIndex({}, { ...merged, ...stripExtends(raw), kind: "common" });
  } else {
    const commonPath = roleYamlPath(rolesDir, "common");
    if (fs.existsSync(commonPath)) {
      const common = loadRoleFileChain(rolesDir, "common", commonPath, visiting);
      merged = mergeRoleIndex(common, { ...merged, ...stripExtends(raw), kind: raw.kind ?? name });
    } else {
      merged = mergeRoleIndex({}, { ...merged, ...stripExtends(raw), kind: raw.kind ?? name });
    }
  }

  visiting.delete(key);
  return merged;
}

function stripExtends(raw: RoleYaml): Partial<RoleIndex> {
  const { extends: _e, ...rest } = raw;
  return rest;
}

/**
 * Pane column id -> merged role index.
 * 1. Seat kind file (`manager.yaml`) with optional `extends:` chain (+ implicit common).
 * 2. Optional column overlay `.sm/roles/columns/<columnId>.yaml` with `extends: manager` (etc.).
 * Never load `roles/<columnId>.yaml` as a kind — use `columns/<columnId>.yaml`.
 */
export function loadRoleIndex(rolesDir: string, paneRoleId: string): RoleIndex {
  const columnId = normalizeRoleKind(paneRoleId);
  const seatKind = seatKindFromId(columnId);
  const overlayPath = columnOverlayPath(rolesDir, columnId);
  if (columnId !== seatKind && fs.existsSync(overlayPath)) {
    const merged = loadRoleFileChain(rolesDir, columnId, overlayPath, new Set());
    merged.kind = seatKind;
    return merged;
  }
  const kindPath = roleYamlPath(rolesDir, seatKind);
  const merged = loadRoleFileChain(rolesDir, seatKind, kindPath, new Set());
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

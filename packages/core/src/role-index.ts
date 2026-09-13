import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { seatKindFromId } from "./schema/seat-kind.js";

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
  /** Printed first on ./sm.sh whoami (patterns.md / ONE-PATH). */
  banner?: string[];
  read_first?: RoleIndexEntry[];
  policies?: RolePolicy[];
  files?: string[];
  inject?: string[];
  vars?: Record<string, string>;
  /** Comms + builtin command guards (AGENT-FUNC-GUARDS.md / ROLE-YAML.md). */
  guards?: RoleAllowDeny;
  /** Attached-external (./sm.sh func) allow/deny per role. */
  funcs?: RoleAllowDeny;
}

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
  return {
    ...role,
    banner: [...(base.banner ?? []), ...(role.banner ?? [])],
    read_first: dedupedReadFirst,
    policies: [...(base.policies ?? []), ...(role.policies ?? [])],
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

export function loadRoleIndex(rolesDir: string, kind: string): RoleIndex {
  const normalized = normalizeRoleKind(kind);
  const seatKind = seatKindFromId(normalized);
  const specific = path.join(rolesDir, `${normalized}.yaml`);
  const kindFile = path.join(rolesDir, `${seatKind}.yaml`);
  const file = fs.existsSync(specific) ? specific : kindFile;
  if (!fs.existsSync(file)) {
    throw new Error(`role index missing: ${file}`);
  }
  let common: Partial<RoleIndex> = {};
  const commonFile = path.join(rolesDir, "common.yaml");
  if (fs.existsSync(commonFile)) {
    common = YAML.parse(fs.readFileSync(commonFile, "utf8")) as Partial<RoleIndex>;
  }
  const data = YAML.parse(fs.readFileSync(file, "utf8")) as RoleIndex;
  if (!data.kind) data.kind = normalized;
  return mergeRoleIndex(common, data);
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

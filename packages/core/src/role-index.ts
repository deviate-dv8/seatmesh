import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

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

export interface RoleIndex {
  kind: string;
  /** Printed first on ./sm.sh whoami (patterns.md / ONE-PATH). */
  banner?: string[];
  read_first?: RoleIndexEntry[];
  policies?: RolePolicy[];
  files?: string[];
  inject?: string[];
  vars?: Record<string, string>;
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
  };
}

/** Deprecated alias: prefer "manager" not "master" for the coordinator pane. */
function normalizeRoleKind(kind: string): string {
  return kind === "master" ? "manager" : kind;
}

export function loadRoleIndex(rolesDir: string, kind: string): RoleIndex {
  const normalized = normalizeRoleKind(kind);
  const file = path.join(rolesDir, `${normalized}.yaml`);
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
  opts: { skipBanner?: boolean } = {},
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

  for (const f of index.files ?? []) {
    lines.push(`file=${substituteVars(f, vars)}`);
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

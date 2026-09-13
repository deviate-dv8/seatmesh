import fs from "node:fs";
import {
  loadRoleIndex,
  profilePaths,
  validateRoleIndex,
  type LoadedProfile,
} from "@seat-mesh/core";
import { roleKindFromWhoami, runWhoami } from "./whoami.js";

export interface AgentContextEntry {
  path: string;
  note?: string;
  missing: boolean;
}

export interface AgentContextReport {
  role: string;
  kind: string;
  slotLabel: string | null;
  readFirst: AgentContextEntry[];
  files: AgentContextEntry[];
  missing: string[];
  ok: boolean;
}

function entry(path: string, note: string | undefined, missingSet: Set<string>): AgentContextEntry {
  return { path, note, missing: missingSet.has(path) };
}

export function buildAgentContextReport(loaded: LoadedProfile, target?: string): AgentContextReport {
  const w = runWhoami(loaded, target);
  const paths = profilePaths(loaded);
  const kind = roleKindFromWhoami(w.role);
  const index = loadRoleIndex(paths.rolesDir, kind);
  const validation = validateRoleIndex(index, loaded.workspace);
  const missingSet = new Set(validation.missing);

  const readFirst = (index.read_first ?? []).map((item) =>
    entry(item.path, item.note, missingSet),
  );
  const files = (index.files ?? []).map((f) => entry(f, undefined, missingSet));

  return {
    role: w.role,
    kind,
    slotLabel: w.slotLabel,
    readFirst,
    files,
    missing: validation.missing,
    ok: validation.ok,
  };
}

export function formatAgentContextReport(report: AgentContextReport): string[] {
  const head =
    report.slotLabel != null
      ? `role=${report.kind} slot=${report.slotLabel}`
      : `role=${report.kind} you_are=${report.role}`;
  const lines: string[] = [head, "--- read_first (required) ---"];
  if (report.readFirst.length === 0) {
    lines.push("  (none registered)");
  } else {
    for (const item of report.readFirst) {
      const suffix = item.missing ? " MISSING" : "";
      lines.push(`  ${item.path}${item.note ? ` | ${item.note}` : ""}${suffix}`);
    }
  }
  lines.push("--- files (FYI) ---");
  if (report.files.length === 0) {
    lines.push("  (none registered)");
  } else {
    for (const item of report.files) {
      lines.push(`  ${item.path}${item.missing ? " MISSING" : ""}`);
    }
  }
  lines.push("--- missing (fix dotdir) ---");
  if (report.missing.length === 0) {
    lines.push("  (none)");
  } else {
    for (const m of report.missing) lines.push(`  ${m}`);
  }
  return lines;
}

export function printAgentContext(loaded: LoadedProfile, target?: string): number {
  const report = buildAgentContextReport(loaded, target);
  for (const line of formatAgentContextReport(report)) {
    console.log(line);
  }
  return report.ok ? 0 : 1;
}

const ROLE_YAML_SKIP = new Set(["common.yaml"]);

function listRoleKinds(rolesDir: string): string[] {
  if (!fs.existsSync(rolesDir)) return [];
  return fs
    .readdirSync(rolesDir)
    .filter((f) => f.endsWith(".yaml") && !ROLE_YAML_SKIP.has(f))
    .map((f) => f.replace(/\.yaml$/, ""));
}

export function printAgentContextAllRoles(loaded: LoadedProfile): number {
  const paths = profilePaths(loaded);
  let ok = true;
  for (const kind of listRoleKinds(paths.rolesDir)) {
    console.log(`=== ${kind} ===`);
    try {
      const index = loadRoleIndex(paths.rolesDir, kind);
      const validation = validateRoleIndex(index, loaded.workspace);
      if (!validation.ok) ok = false;
      const missingSet = new Set(validation.missing);
      const pseudo: AgentContextReport = {
        role: kind,
        kind,
        slotLabel: null,
        readFirst: (index.read_first ?? []).map((item) =>
          entry(item.path, item.note, missingSet),
        ),
        files: (index.files ?? []).map((f) => entry(f, undefined, missingSet)),
        missing: validation.missing,
        ok: validation.ok,
      };
      for (const line of formatAgentContextReport(pseudo)) {
        console.log(line);
      }
      console.log("");
    } catch (e) {
      ok = false;
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
      console.log("");
    }
  }
  return ok ? 0 : 1;
}

export function validateAllRoleIndexes(
  loaded: LoadedProfile,
): { ok: boolean; failures: { kind: string; missing: string[] }[] } {
  const paths = profilePaths(loaded);
  const failures: { kind: string; missing: string[] }[] = [];
  for (const kind of listRoleKinds(paths.rolesDir)) {
    try {
      const index = loadRoleIndex(paths.rolesDir, kind);
      const result = validateRoleIndex(index, loaded.workspace);
      if (!result.ok) failures.push({ kind, missing: result.missing });
    } catch (e) {
      failures.push({ kind, missing: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return { ok: failures.length === 0, failures };
}

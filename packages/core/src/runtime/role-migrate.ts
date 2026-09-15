/**
 * Role-pack migrators — move profiles between pack versions (up or down).
 * Each step is registered once; migrate walks the path.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  CURRENT_ROLE_PACK_VERSION,
  ROLE_KINDS,
  compareRolePackVersion,
  extendStubBody,
  inspectRolePack,
  installedRolePackVersion,
  parseRoleYamlFile,
  roleExtendPath,
  roleLegacyFlatPath,
  rolePackManifestPath,
  roleVendorDocsDir,
  roleVendorPath,
  stripRoleMetaKeys,
  vendorRolesDir,
  writeRolePackManifest,
  type RolePackStatus,
} from "./role-pack.js";
import { deepEqualJson } from "./role-migrate-util.js";

export interface RoleMigrateStep {
  from: string;
  to: string;
  description: string;
  up: (ctx: RoleMigrateCtx) => void;
  down: (ctx: RoleMigrateCtx) => void;
}

export interface RoleMigrateCtx {
  rolesDir: string;
  /** Engine template roles dir (packages/cli/templates/init/roles). */
  templateRolesDir: string;
  dryRun: boolean;
  log: (line: string) => void;
  touched: string[];
}

export interface RoleMigrateResult {
  from: string | null;
  to: string;
  direction: "up" | "down" | "noop";
  steps: string[];
  touched: string[];
  status: RolePackStatus;
}

function copyFile(src: string, dest: string, dryRun: boolean, touched: string[]): void {
  if (!fs.existsSync(src)) return;
  if (dryRun) {
    touched.push(dest);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  touched.push(dest);
}

function writeText(dest: string, body: string, dryRun: boolean, touched: string[]): void {
  if (dryRun) {
    touched.push(dest);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body, "utf8");
  touched.push(dest);
}

function syncVendorFromTemplate(ctx: RoleMigrateCtx): void {
  const srcRoot = ctx.templateRolesDir;
  if (!fs.existsSync(srcRoot)) {
    ctx.log(`WARN: template roles missing at ${srcRoot}`);
    return;
  }
  // yaml kinds + ROLE_PACK.json
  for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (ent.name === "extend") continue; // stubs handled separately
    const src = path.join(srcRoot, ent.name);
    const dest = path.join(vendorRolesDir(ctx.rolesDir), ent.name);
    if (ent.isDirectory()) {
      syncTree(src, dest, ctx);
      continue;
    }
    copyFile(src, dest, ctx.dryRun, ctx.touched);
  }
}

function syncTree(srcDir: string, destDir: string, ctx: RoleMigrateCtx): void {
  if (!fs.existsSync(srcDir)) return;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      syncTree(src, dest, ctx);
      continue;
    }
    copyFile(src, dest, ctx.dryRun, ctx.touched);
  }
}

/**
 * Diff legacy flat yaml vs vendor: anything not equal goes into extend
 * (so user customizations survive the 1.0 → 1.1 lift).
 */
function promoteLegacyFlatToExtend(ctx: RoleMigrateCtx): void {
  for (const kind of ROLE_KINDS) {
    const flat = roleLegacyFlatPath(ctx.rolesDir, kind);
    const vendor = roleVendorPath(ctx.rolesDir, kind);
    const extend = roleExtendPath(ctx.rolesDir, kind);
    if (!fs.existsSync(flat)) {
      if (!fs.existsSync(extend)) {
        writeText(
          extend,
          extendStubBody(kind, CURRENT_ROLE_PACK_VERSION),
          ctx.dryRun,
          ctx.touched,
        );
      }
      continue;
    }
    if (fs.existsSync(extend)) {
      ctx.log(`keep existing ${path.basename(extend)}`);
      continue;
    }
    if (!fs.existsSync(vendor)) {
      // no vendor yet — copy flat aside as extend after vendor sync
      const raw = parseRoleYamlFile(flat);
      const body =
        `# Migrated from legacy ${kind}.yaml (role-pack 1.0 → 1.1)\n` +
        YAML.stringify(stripRoleMetaKeys(raw));
      writeText(extend, body, ctx.dryRun, ctx.touched);
      continue;
    }
    const flatRaw = stripRoleMetaKeys(parseRoleYamlFile(flat));
    const vendorRaw = stripRoleMetaKeys(parseRoleYamlFile(vendor));
    if (deepEqualJson(flatRaw, vendorRaw)) {
      writeText(
        extend,
        extendStubBody(kind, CURRENT_ROLE_PACK_VERSION),
        ctx.dryRun,
        ctx.touched,
      );
      ctx.log(`${kind}: flat matched vendor → empty extend stub`);
      continue;
    }
    // Keep full flat as extend — locked merge will preserve vendor ids.
    const body =
      `# Migrated from legacy ${kind}.yaml (role-pack 1.0 → 1.1)\n` +
      `# Locked vendor policy ids / banners stay engine-owned; extras below apply.\n` +
      YAML.stringify(flatRaw);
    writeText(extend, body, ctx.dryRun, ctx.touched);
    ctx.log(`${kind}: promoted flat → ${path.basename(extend)}`);
  }
}

function archiveLegacyFlat(ctx: RoleMigrateCtx): void {
  const archiveDir = path.join(ctx.rolesDir, "_legacy_flat");
  for (const kind of ROLE_KINDS) {
    const flat = roleLegacyFlatPath(ctx.rolesDir, kind);
    if (!fs.existsSync(flat)) continue;
    const dest = path.join(archiveDir, `${kind}.yaml`);
    if (ctx.dryRun) {
      ctx.touched.push(dest);
      continue;
    }
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(flat, dest);
    ctx.touched.push(dest);
    ctx.log(`archived legacy ${kind}.yaml → _legacy_flat/`);
  }
}

/** Flatten vendor+extend back to flat kind.yaml (1.1 → 1.0). */
function flattenToLegacy(ctx: RoleMigrateCtx): void {
  for (const kind of ROLE_KINDS) {
    const vendor = roleVendorPath(ctx.rolesDir, kind);
    const extend = roleExtendPath(ctx.rolesDir, kind);
    const flat = roleLegacyFlatPath(ctx.rolesDir, kind);
    if (!fs.existsSync(vendor) && !fs.existsSync(extend)) continue;
    const merged: Record<string, unknown> = fs.existsSync(vendor)
      ? stripRoleMetaKeys(parseRoleYamlFile(vendor))
      : {};
    if (fs.existsSync(extend)) {
      const ext = stripRoleMetaKeys(parseRoleYamlFile(extend));
      // shallow merge lists by replace-with-concat for known keys
      for (const [k, v] of Object.entries(ext)) {
        if (Array.isArray(merged[k]) && Array.isArray(v)) {
          merged[k] = [...(merged[k] as unknown[]), ...v];
        } else if (v && typeof v === "object" && !Array.isArray(v) && merged[k] && typeof merged[k] === "object") {
          merged[k] = { ...(merged[k] as object), ...(v as object) };
        } else {
          merged[k] = v;
        }
      }
    }
    writeText(flat, YAML.stringify(merged), ctx.dryRun, ctx.touched);
  }
}

const STEPS: RoleMigrateStep[] = [
  {
    from: "1.0.0",
    to: "1.1.0",
    description: "vendor+extend layout, locked sections, base role MDs",
    up(ctx) {
      syncVendorFromTemplate(ctx);
      promoteLegacyFlatToExtend(ctx);
      archiveLegacyFlat(ctx);
      writeRolePackManifest(
        ctx.rolesDir,
        {
          version: "1.1.0",
          notes: "Locked _vendor roles + *.extend.yaml; docs under _vendor/docs/",
          locked_sections: ["banner", "read_first", "policies"],
          kinds: [...ROLE_KINDS],
        },
        ctx.dryRun,
      );
      ctx.touched.push(rolePackManifestPath(ctx.rolesDir));
    },
    down(ctx) {
      flattenToLegacy(ctx);
      // leave _vendor in place but stamp 1.0 so old tools expecting flat work
      writeRolePackManifest(
        ctx.rolesDir,
        {
          version: "1.0.0",
          notes: "Flattened for legacy loaders (flat roles/*.yaml)",
        },
        ctx.dryRun,
      );
      ctx.touched.push(rolePackManifestPath(ctx.rolesDir));
    },
  },
];

function normalizePackVersion(v: string | null | undefined): string {
  if (!v) return "1.0.0";
  // treat any 1.0.x profile without ROLE_PACK as 1.0.0
  if (v.startsWith("1.0.")) return "1.0.0";
  return v;
}

function pathBetween(from: string, to: string): RoleMigrateStep[] {
  if (from === to) return [];
  const direction = compareRolePackVersion(from, to) < 0 ? "up" : "down";
  if (direction === "up") {
    const out: RoleMigrateStep[] = [];
    let cur = from;
    while (compareRolePackVersion(cur, to) < 0) {
      const step = STEPS.find((s) => s.from === cur);
      if (!step) {
        throw new Error(`no role-pack migrate step upward from ${cur} toward ${to}`);
      }
      out.push(step);
      cur = step.to;
      if (out.length > 20) throw new Error("role-pack migrate path too long");
    }
    return out;
  }
  const out: RoleMigrateStep[] = [];
  let cur = from;
  while (compareRolePackVersion(cur, to) > 0) {
    const step = STEPS.find((s) => s.to === cur);
    if (!step) {
      throw new Error(`no role-pack migrate step downward from ${cur} toward ${to}`);
    }
    out.push(step);
    cur = step.from;
    if (out.length > 20) throw new Error("role-pack migrate path too long");
  }
  return out;
}

export function listRoleMigrateSteps(): { from: string; to: string; description: string }[] {
  return STEPS.map((s) => ({ from: s.from, to: s.to, description: s.description }));
}

export function runRolePackMigrate(opts: {
  rolesDir: string;
  templateRolesDir: string;
  to?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}): RoleMigrateResult {
  const to = normalizePackVersion(opts.to ?? CURRENT_ROLE_PACK_VERSION);
  const fromRaw = installedRolePackVersion(opts.rolesDir);
  // No manifest + legacy flat → 1.0.0; no manifest + vendor only → still migrate to stamp
  const from = normalizePackVersion(
    fromRaw ?? (fs.existsSync(roleLegacyFlatPath(opts.rolesDir, "common")) ? "1.0.0" : "1.0.0"),
  );
  const log = opts.log ?? (() => {});
  const dryRun = Boolean(opts.dryRun);
  const touched: string[] = [];
  const ctx: RoleMigrateCtx = {
    rolesDir: opts.rolesDir,
    templateRolesDir: opts.templateRolesDir,
    dryRun,
    log,
    touched,
  };

  if (from === to && !inspectRolePack(opts.rolesDir, to).needsMigrate) {
    return {
      from: fromRaw,
      to,
      direction: "noop",
      steps: [],
      touched: [],
      status: inspectRolePack(opts.rolesDir, to),
    };
  }

  // Force re-apply when target==installed but vendor/docs/extend incomplete.
  const steps =
    from === to
      ? STEPS.filter((s) => s.to === to)
      : pathBetween(from, to);
  const direction =
    from === to
      ? "up"
      : compareRolePackVersion(from, to) < 0
        ? "up"
        : "down";
  const stepNames: string[] = [];

  for (const step of steps) {
    const label = `${step.from}→${step.to}`;
    stepNames.push(label);
    log(`role-pack migrate ${direction} ${label}: ${step.description}`);
    if (direction === "up") step.up(ctx);
    else step.down(ctx);
  }

  // Ensure docs exist after up
  if (direction === "up" && !dryRun) {
    const docs = roleVendorDocsDir(opts.rolesDir);
    if (!fs.existsSync(docs)) {
      syncVendorFromTemplate(ctx);
    }
  }

  return {
    from: fromRaw,
    to,
    direction: stepNames.length ? direction : "noop",
    steps: stepNames,
    touched,
    status: inspectRolePack(opts.rolesDir, to),
  };
}

export { CURRENT_ROLE_PACK_VERSION, inspectRolePack };

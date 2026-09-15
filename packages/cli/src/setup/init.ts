import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SM_DIR, SM_CONFIG } from "@seat-mesh/core";

export interface InitOptions {
  /** Project root (default cwd). */
  workspace?: string;
  /** Profile name slug (default: basename of workspace). */
  name?: string;
  /** seats.root in yaml — default `<dotdir>/seats` for greenfield. */
  seatsRoot?: string;
  /** Overwrite existing dotdir (default refuse). */
  force?: boolean;
  /**
   * Dotdir under workspace: `.sm` (default) or `.sm-<id>` for multi-config.
   * Prefer {@link normalizeSmProfileDir} for named configs.
   */
  smDirName?: string;
}

export interface InitResult {
  smDir: string;
  configPath: string;
  created: string[];
  skipped: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// init.ts lives in src/setup/ (dist/setup/), templates sit at packages/cli/templates/
const TEMPLATE_ROOT = path.join(__dirname, "..", "..", "templates", "init");

function tpl(name: string, vars: Record<string, string>): string {
  const raw = fs.readFileSync(path.join(TEMPLATE_ROOT, name), "utf8");
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function copyTree(srcDir: string, destDir: string, created: string[], skipped: string[], force: boolean): void {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTree(src, dest, created, skipped, force);
      continue;
    }
    if (fs.existsSync(dest) && !force) {
      skipped.push(dest);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    created.push(dest);
  }
}

/** Create `.sm/` (or `.sm-<id>/`) dotdir in a project. Never touches existing seat FOCUS/TASKS. */
export function runInit(opts: InitOptions = {}): InitResult {
  const workspace = path.resolve(opts.workspace ?? process.cwd());
  const smDirName = opts.smDirName?.trim() || SM_DIR;
  if (!smDirName.startsWith(".sm")) {
    throw new Error(`smDirName must be .sm or .sm-<id> (got ${smDirName})`);
  }
  const smDir = path.join(workspace, smDirName);
  const configPath = path.join(smDir, SM_CONFIG);
  const created: string[] = [];
  const skipped: string[] = [];

  if (fs.existsSync(configPath) && !opts.force) {
    throw new Error(
      `${configPath} already exists — use --force to replace templates (does not delete seat FOCUS/TASKS under seats.root)`,
    );
  }

  const name = opts.name ?? path.basename(workspace);
  // paths.scope=profile → seats root is relative to .sm/, not workspace
  const seatsRoot = opts.seatsRoot ?? "seats";

  fs.mkdirSync(smDir, { recursive: true });
  fs.mkdirSync(path.join(smDir, "runtime", "daemon"), { recursive: true });

  const vars = { name, seatsRoot, workdir: workspace };

  const writeTpl = (rel: string) => {
    const dest = path.join(smDir, rel);
    if (fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, tpl(rel, vars));
    created.push(dest);
  };

  writeTpl("mesh.config.yaml");
  writeTpl("mesh-agents.json");
  writeTpl("README.md");
  writeTpl("AGENTS.md");

  // Role-pack 1.1+: locked templates → roles/_vendor/; user stubs → *.extend.yaml
  const rolesSrc = path.join(TEMPLATE_ROOT, "roles");
  const rolesDest = path.join(smDir, "roles");
  const vendorDest = path.join(rolesDest, "_vendor");
  fs.mkdirSync(vendorDest, { recursive: true });
  for (const ent of fs.readdirSync(rolesSrc, { withFileTypes: true })) {
    if (ent.name === "extend") continue;
    const src = path.join(rolesSrc, ent.name);
    const dest = path.join(vendorDest, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTree(src, dest, created, skipped, Boolean(opts.force));
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    created.push(dest);
  }
  const extendSrc = path.join(rolesSrc, "extend");
  if (fs.existsSync(extendSrc)) {
    for (const ent of fs.readdirSync(extendSrc, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith(".extend.yaml")) continue;
      const dest = path.join(rolesDest, ent.name);
      if (fs.existsSync(dest) && !opts.force) {
        skipped.push(dest);
        continue;
      }
      fs.copyFileSync(path.join(extendSrc, ent.name), dest);
      created.push(dest);
    }
  }

  // Stamp pack version file for status/migrate
  const packSrc = path.join(vendorDest, "ROLE_PACK.json");
  if (fs.existsSync(packSrc)) {
    created.push(packSrc);
  }

  const agents = ensureAgentsCliDoc(smDir, {
    workspace,
    forceRefresh: Boolean(opts.force),
    smDirName,
  });
  created.push(...agents.created);
  skipped.push(...agents.skipped);

  return { smDir, configPath, created, skipped };
}

/** Ensure locked vendor roles + empty extend stubs exist (never overwrite user extend). */
export function ensureMissingRoleTemplates(smDir: string): { created: string[] } {
  const rolesSrc = path.join(TEMPLATE_ROOT, "roles");
  const rolesDest = path.join(smDir, "roles");
  const vendorDest = path.join(rolesDest, "_vendor");
  const created: string[] = [];
  if (!fs.existsSync(rolesSrc)) return { created };
  fs.mkdirSync(vendorDest, { recursive: true });
  for (const ent of fs.readdirSync(rolesSrc, { withFileTypes: true })) {
    if (ent.name === "extend") continue;
    const src = path.join(rolesSrc, ent.name);
    const dest = path.join(vendorDest, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyTree(src, dest, created, [], false);
      continue;
    }
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    created.push(dest);
  }
  const extendSrc = path.join(rolesSrc, "extend");
  if (fs.existsSync(extendSrc)) {
    for (const ent of fs.readdirSync(extendSrc, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith(".extend.yaml")) continue;
      const dest = path.join(rolesDest, ent.name);
      if (fs.existsSync(dest)) continue;
      fs.copyFileSync(path.join(extendSrc, ent.name), dest);
      created.push(dest);
    }
  }
  return { created };
}

/** Absolute path to engine role templates (for migrate). */
export function roleTemplatesDir(): string {
  return path.join(TEMPLATE_ROOT, "roles");
}

const AGENTS_MD = "AGENTS.md";

/** Engine-owned seatmesh CLI brief — every agent read_first / Cursor AGENTS.md. */
export function agentsMdTemplatePath(): string {
  return path.join(TEMPLATE_ROOT, AGENTS_MD);
}

/**
 * Ensure `.sm/AGENTS.md` exists (and refresh when template differs).
 * Optionally seed workspace-root `AGENTS.md` only when missing (never clobber).
 */
export function ensureAgentsCliDoc(
  smDir: string,
  opts: { workspace?: string; forceRefresh?: boolean; smDirName?: string } = {},
): { created: string[]; refreshed: string[]; skipped: string[] } {
  const created: string[] = [];
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const src = agentsMdTemplatePath();
  if (!fs.existsSync(src)) return { created, refreshed, skipped };

  const dest = path.join(smDir, AGENTS_MD);
  const body = fs.readFileSync(src);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    created.push(dest);
  } else if (opts.forceRefresh !== false) {
    const same = fs.readFileSync(dest).equals(body);
    if (same) skipped.push(dest);
    else {
      fs.writeFileSync(dest, body);
      refreshed.push(dest);
    }
  } else {
    skipped.push(dest);
  }

  const workspace = opts.workspace ?? path.dirname(smDir);
  const rootAgents = path.join(workspace, AGENTS_MD);
  const smLabel = opts.smDirName ?? path.basename(smDir);
  if (!fs.existsSync(rootAgents)) {
    const multi =
      smLabel !== ".sm"
        ? `Multi-config: \`seatmesh --profile ${smLabel} agent\` · \`seatmesh --profile ${smLabel} agent whoami\`.\n`
        : `Every pane: \`seatmesh agent\` · \`seatmesh agent whoami\` (default walk-up \`.sm/\`).\n`;
    const pointer =
      `# Agent brief\n\n` +
      `Mesh CLI defaults live in \`${smLabel}/AGENTS.md\` (engine-owned).\n` +
      multi +
      `\n` +
      fs.readFileSync(src, "utf8");
    fs.writeFileSync(rootAgents, pointer);
    created.push(rootAgents);
  } else {
    skipped.push(rootAgents);
  }

  return { created, refreshed, skipped };
}

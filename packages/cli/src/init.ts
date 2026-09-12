import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SM_DIR, SM_CONFIG } from "@seat-mesh/core";

export interface InitOptions {
  /** Project root (default cwd). */
  workspace?: string;
  /** Profile name slug (default: basename of workspace). */
  name?: string;
  /** seats.root in yaml — default `.sm/seats` for greenfield. */
  seatsRoot?: string;
  /** Overwrite existing .sm (default refuse). */
  force?: boolean;
}

export interface InitResult {
  smDir: string;
  configPath: string;
  created: string[];
  skipped: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.join(__dirname, "..", "templates", "init");

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

/** Create `.sm/` dotdir in a project (npx seatmesh init). Never touches existing seat FOCUS/TASKS. */
export function runInit(opts: InitOptions = {}): InitResult {
  const workspace = path.resolve(opts.workspace ?? process.cwd());
  const smDir = path.join(workspace, SM_DIR);
  const configPath = path.join(smDir, SM_CONFIG);
  const created: string[] = [];
  const skipped: string[] = [];

  if (fs.existsSync(configPath) && !opts.force) {
    throw new Error(
      `${configPath} already exists — use --force to replace templates (does not delete seat FOCUS/TASKS under seats.root)`,
    );
  }

  const name = opts.name ?? path.basename(workspace);
  const seatsRoot = opts.seatsRoot ?? ".sm/seats";

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

  const rolesSrc = path.join(TEMPLATE_ROOT, "roles");
  const rolesDest = path.join(smDir, "roles");
  fs.mkdirSync(rolesDest, { recursive: true });
  copyTree(rolesSrc, rolesDest, created, skipped, Boolean(opts.force));

  return { smDir, configPath, created, skipped };
}

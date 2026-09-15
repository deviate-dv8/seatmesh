import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildResolvedPaths,
  contractsDirFor,
  loadProfile,
  runRolePackMigrate,
  writePathsManifest,
  type LoadedProfile,
} from "@seat-mesh/core";
import {
  readInstalledCliVersion,
  readProfileSeatmeshVersion,
} from "../ui/version-nudge.js";
import { runMigrateRuntime, type MigrateRuntimeResult } from "./migrate-runtime.js";
import { mergeMeshConfigOnUpdate, type MeshConfigMergeResult } from "./merge-mesh-config.js";
import { roleTemplatesDir } from "./init.js";
import { ensureSeatFiles } from "@seat-mesh/tmux";

export interface UpdateOptions {
  profileArg?: string;
  dryRun?: boolean;
  migrate?: boolean;
}

export interface UpdateResult {
  refreshed: string[];
  skipped: string[];
  pathsManifest: string;
  migrate?: MigrateRuntimeResult;
  rolePack?: ReturnType<typeof runRolePackMigrate>;
  configMerge?: MeshConfigMergeResult;
  packageVersion: string;
  previousVersion: string | null;
  /** Any _vendor file or paths.json actually changed (or would change in dry-run). */
  changed: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// update.ts lives in src/setup/ (dist/setup/), templates sit at packages/cli/templates/
const VENDOR_ROOT = path.join(__dirname, "..", "..", "templates", "init");

function writeProfileVersion(profileDir: string, version: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.writeFileSync(path.join(profileDir, ".seatmesh-version"), `${version}\n`, "utf8");
}

/**
 * Sync one locked _vendor file — never rm the tree; copy only when missing or content differs.
 */
function syncVendorFile(
  src: string,
  dest: string,
  refreshed: string[],
  skipped: string[],
  dryRun: boolean,
): void {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) {
    const same = fs.readFileSync(src).equals(fs.readFileSync(dest));
    if (same) {
      skipped.push(dest);
      return;
    }
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  refreshed.push(dest);
}

/** Walk template tree; file-by-file into _vendor (no folder wipe). */
function syncVendorTree(
  srcDir: string,
  destDir: string,
  refreshed: string[],
  skipped: string[],
  dryRun: boolean,
): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      syncVendorTree(src, dest, refreshed, skipped, dryRun);
      continue;
    }
    syncVendorFile(src, dest, refreshed, skipped, dryRun);
  }
}

/** Refresh locked vendor templates + regenerate paths.json (never clobber user runtime). */
export function runUpdate(opts: UpdateOptions = {}): UpdateResult {
  const loaded = loadProfile(opts.profileArg);
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const dryRun = Boolean(opts.dryRun);
  const packageVersion = readInstalledCliVersion();
  const previousVersion = readProfileSeatmeshVersion(loaded.profileDir);

  const rolesVendorSrc = path.join(VENDOR_ROOT, "roles");
  const rolesVendorDest = path.join(loaded.profileDir, "roles", "_vendor");
  // Sync locked files (skip extend/ stubs dir — those are user-facing copies)
  if (fs.existsSync(rolesVendorSrc)) {
    for (const ent of fs.readdirSync(rolesVendorSrc, { withFileTypes: true })) {
      if (ent.name === "extend") continue;
      const src = path.join(rolesVendorSrc, ent.name);
      const dest = path.join(rolesVendorDest, ent.name);
      if (ent.isDirectory()) {
        syncVendorTree(src, dest, refreshed, skipped, dryRun);
      } else {
        syncVendorFile(src, dest, refreshed, skipped, dryRun);
      }
    }
  }

  // Ensure empty extend stubs exist (never overwrite user extend)
  const extendSrc = path.join(rolesVendorSrc, "extend");
  if (fs.existsSync(extendSrc)) {
    for (const ent of fs.readdirSync(extendSrc, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith(".extend.yaml")) continue;
      const dest = path.join(loaded.profileDir, "roles", ent.name);
      if (fs.existsSync(dest)) {
        skipped.push(dest);
        continue;
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(extendSrc, ent.name), dest);
      }
      refreshed.push(dest);
    }
  }

  const agentsSrc = path.join(VENDOR_ROOT, "AGENTS.md");
  const agentsDest = path.join(loaded.profileDir, "AGENTS.md");
  syncVendorFile(agentsSrc, agentsDest, refreshed, skipped, dryRun);
  if (!dryRun && fs.existsSync(agentsSrc)) {
    const rootAgents = path.join(loaded.workspace, "AGENTS.md");
    if (!fs.existsSync(rootAgents)) {
      const pointer =
        `# Agent brief\n\n` +
        `Mesh CLI defaults live in \`.sm/AGENTS.md\` (engine-owned).\n` +
        `Every pane: \`seatmesh agent\` · \`seatmesh agent whoami\`.\n\n` +
        fs.readFileSync(agentsSrc, "utf8");
      fs.writeFileSync(rootAgents, pointer);
      refreshed.push(rootAgents);
    }
  }

  const contractsVendorSrc = path.join(VENDOR_ROOT, "contracts", "_vendor");
  const contractsVendorDest = path.join(contractsDirFor(loaded), "_vendor");
  if (fs.existsSync(contractsVendorSrc)) {
    syncVendorTree(contractsVendorSrc, contractsVendorDest, refreshed, skipped, dryRun);
  } else {
    const superviseTpl = path.join(VENDOR_ROOT, "contracts", "supervise.yaml");
    if (fs.existsSync(superviseTpl)) {
      syncVendorFile(
        superviseTpl,
        path.join(contractsVendorDest, "supervise.yaml"),
        refreshed,
        skipped,
        dryRun,
      );
    }
  }

  const pathsManifest = path.join(loaded.profileDir, "paths.json");
  if (!dryRun) {
    writePathsManifest(loaded);
  }

  let migrate: MigrateRuntimeResult | undefined;
  if (opts.migrate) {
    migrate = runMigrateRuntime({ profileArg: opts.profileArg, dryRun });
  }

  // Role-pack up/down to CURRENT_ROLE_PACK_VERSION (idempotent).
  const rolePack = runRolePackMigrate({
    rolesDir: path.join(loaded.profileDir, "roles"),
    templateRolesDir: roleTemplatesDir(),
    dryRun,
    log: (line) => {
      if (!dryRun) refreshed.push(`role-pack:${line}`);
    },
  });
  for (const t of rolePack.touched) {
    if (!refreshed.includes(t)) refreshed.push(t);
  }

  ensureRuntimeDirs(loaded, refreshed, skipped, dryRun);

  const configMerge = mergeMeshConfigOnUpdate(loaded, dryRun);
  for (const key of configMerge.added) {
    refreshed.push(`${configMerge.profilePath}#${key}`);
  }

  // Seed seats/_shared (+ missing FOCUS/TASKS trios) — never overwrite live seat MDs.
  if (!dryRun) {
    const seats = ensureSeatFiles(loaded);
    for (const p of seats.created) {
      if (!refreshed.includes(p)) refreshed.push(p);
    }
  } else {
    const sharedNotes = path.join(buildResolvedPaths(loaded).seatsRoot, "_shared", "NOTES.md");
    if (!fs.existsSync(sharedNotes)) refreshed.push(sharedNotes);
  }

  const vendorTouched = refreshed.some((p) => p.includes(`${path.sep}_vendor${path.sep}`));
  const changed =
    refreshed.length > 0 ||
    previousVersion !== packageVersion ||
    rolePack.direction !== "noop" ||
    (configMerge.added.length > 0);
  if (
    !dryRun &&
    (vendorTouched ||
      previousVersion !== packageVersion ||
      rolePack.direction !== "noop" ||
      configMerge.wrote)
  ) {
    writeProfileVersion(loaded.profileDir, packageVersion, false);
  }

  return {
    refreshed,
    skipped,
    pathsManifest,
    migrate,
    rolePack,
    configMerge,
    packageVersion,
    previousVersion,
    changed,
  };
}

function ensureRuntimeDirs(
  loaded: LoadedProfile,
  refreshed: string[],
  skipped: string[],
  dryRun: boolean,
): void {
  const paths = buildResolvedPaths(loaded);
  for (const dir of [
    paths.daemonDir,
    paths.chatRoomsRoot,
    paths.seatsRoot,
    paths.contractsDir,
    path.join(paths.contractsDir, "locks"),
  ]) {
    if (fs.existsSync(dir)) {
      skipped.push(dir);
      continue;
    }
    if (!dryRun) fs.mkdirSync(dir, { recursive: true });
    refreshed.push(dir);
  }
}

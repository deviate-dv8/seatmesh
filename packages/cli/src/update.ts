import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildResolvedPaths,
  contractsDirFor,
  loadProfile,
  writePathsManifest,
  type LoadedProfile,
} from "seat-mesh-core";
import { runMigrateRuntime, type MigrateRuntimeResult } from "./migrate-runtime.js";

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
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_ROOT = path.join(__dirname, "..", "templates", "init");

function copyVendorTree(
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
      copyVendorTree(src, dest, refreshed, skipped, dryRun);
      continue;
    }
    if (fs.existsSync(dest)) {
      skipped.push(dest);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    refreshed.push(dest);
  }
}

/** Refresh locked vendor templates + regenerate paths.json (never clobber user runtime). */
export function runUpdate(opts: UpdateOptions = {}): UpdateResult {
  const loaded = loadProfile(opts.profileArg);
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const dryRun = Boolean(opts.dryRun);

  const rolesVendorSrc = path.join(VENDOR_ROOT, "roles");
  const rolesVendorDest = path.join(loaded.profileDir, "roles", "_vendor");
  copyVendorTree(rolesVendorSrc, rolesVendorDest, refreshed, skipped, dryRun);

  const contractsVendorSrc = path.join(VENDOR_ROOT, "contracts", "_vendor");
  const contractsVendorDest = path.join(contractsDirFor(loaded), "_vendor");
  if (fs.existsSync(contractsVendorSrc)) {
    copyVendorTree(contractsVendorSrc, contractsVendorDest, refreshed, skipped, dryRun);
  } else {
    const superviseTpl = path.join(VENDOR_ROOT, "contracts", "supervise.yaml");
    if (fs.existsSync(superviseTpl)) {
      const dest = path.join(contractsVendorDest, "supervise.yaml");
      if (fs.existsSync(dest)) skipped.push(dest);
      else if (!dryRun) {
        fs.mkdirSync(contractsVendorDest, { recursive: true });
        fs.copyFileSync(superviseTpl, dest);
        refreshed.push(dest);
      } else refreshed.push(dest);
    }
  }

  let pathsManifest = buildResolvedPaths(loaded).meshAgentsJson.replace(/mesh-agents\.json$/, "paths.json");
  pathsManifest = path.join(loaded.profileDir, "paths.json");
  if (!dryRun) {
    writePathsManifest(loaded);
  }

  let migrate: MigrateRuntimeResult | undefined;
  if (opts.migrate) {
    migrate = runMigrateRuntime({ profileArg: opts.profileArg, dryRun });
  }

  ensureRuntimeDirs(loaded, refreshed, skipped, dryRun);

  return { refreshed, skipped, pathsManifest, migrate };
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

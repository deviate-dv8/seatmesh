import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface InstallOptions {
  binDir?: string;
  force?: boolean;
}

export type InstallResult = {
  binDir: string;
  link: string;
  target: string;
  created: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default user-local bin dir (~/.local/bin or $XDG_BIN_HOME). */
export function defaultInstallBinDir(): string {
  const xdg = process.env.XDG_BIN_HOME?.trim();
  if (xdg) return xdg;
  return path.join(os.homedir(), ".local", "bin");
}

/** Locate the tracked bin/seatmesh shim (monorepo or npm package). */
export function resolveRepoBinShim(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "..", "bin", "seatmesh"),
    path.join(__dirname, "..", "..", "bin", "seatmesh"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.realpathSync(c);
  }
  throw new Error("cannot find bin/seatmesh shim (run from seatmesh checkout or npm package)");
}

function resolveSmBinShim(): string {
  const seatmesh = resolveRepoBinShim();
  const sm = path.join(path.dirname(seatmesh), "sm");
  if (fs.existsSync(sm)) return fs.realpathSync(sm);
  return seatmesh;
}

function installOneLink(
  binDir: string,
  name: string,
  target: string,
  force: boolean,
): { link: string; created: boolean } {
  const link = path.join(binDir, name);
  if (fs.existsSync(link)) {
    let existing: string;
    try {
      existing = fs.realpathSync(link);
    } catch {
      if (!force) {
        throw new Error(`already exists: ${link} (use --force to replace)`);
      }
      fs.unlinkSync(link);
      fs.symlinkSync(target, link);
      return { link, created: true };
    }
    if (existing === target) {
      return { link, created: false };
    }
    if (!force) {
      throw new Error(`already exists: ${link} -> ${existing} (use --force to replace)`);
    }
    fs.unlinkSync(link);
  }
  fs.symlinkSync(target, link);
  return { link, created: true };
}

/** Symlink bin/sm (+ bin/seatmesh) into ~/.local/bin (or --bin). Idempotent unless --force. */
export function runInstall(opts: InstallOptions = {}): InstallResult {
  const binDir = path.resolve(opts.binDir?.trim() || defaultInstallBinDir());
  const seatmeshTarget = resolveRepoBinShim();
  const smTarget = resolveSmBinShim();
  fs.mkdirSync(binDir, { recursive: true });
  const force = Boolean(opts.force);
  const { link, created } = installOneLink(binDir, "sm", smTarget, force);
  installOneLink(binDir, "seatmesh", seatmeshTarget, force);
  return { binDir, link, target: smTarget, created };
}

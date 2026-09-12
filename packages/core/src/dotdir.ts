import fs from "node:fs";
import path from "node:path";

export const SM_DIR = ".sm";
export const SM_CONFIG = "mesh.config.yaml";

/** Absolute path to `.sm/mesh.config.yaml` under `dir`, or null. */
export function dotSmConfigIn(dir: string): string | null {
  const cfg = path.join(dir, SM_DIR, SM_CONFIG);
  return fs.existsSync(cfg) ? cfg : null;
}

/**
 * Walk from `startDir` up to filesystem root for `.sm/mesh.config.yaml`.
 * Default start: process.cwd().
 */
export function findDotSmConfig(startDir = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const hit = dotSmConfigIn(dir);
    if (hit) return hit;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function dotSmDirFromConfig(configPath: string): string {
  return path.dirname(configPath);
}

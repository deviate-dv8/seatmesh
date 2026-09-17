import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "../profile/profile.js";
import { stackConfig } from "./config.js";

export function resolveStackScript(loaded: LoadedProfile): string {
  const cfg = stackConfig(loaded.profile);
  const abs = path.isAbsolute(cfg.command)
    ? cfg.command
    : path.join(loaded.workspace, cfg.command);
  if (!fs.existsSync(abs)) {
    throw new Error(`stack script not found: ${abs} (profile stack.command=${cfg.command})`);
  }
  return abs;
}

export function printStackHelp(loaded: LoadedProfile): void {
  const cfg = stackConfig(loaded.profile);
  const script = cfg.command;
  console.log(`seatmesh stack — passthrough to ${script} (only sm external passthrough)`);
  if (cfg.summary) console.log(cfg.summary);
  console.log("");
  console.log("Usage:");
  console.log(`  sm stack up`);
  console.log(`  sm stack reload`);
  console.log(`  sm stack restart 3030 3031`);
  console.log(`  sm stack ps`);
  console.log(`  sm stack down`);
  console.log("");
  console.log(`All arguments pass through to ${script} in workspace ${loaded.workspace}`);
  console.log("Canonical rules: .agent/local-dev.md");
}

/** Run stack driver with passthrough args; stdio inherited. Returns exit code. */
export function runStackPassthrough(loaded: LoadedProfile, args: string[]): number {
  if (
    args.length === 0 ||
    args[0] === "--help" ||
    args[0] === "-h" ||
    args[0] === "help"
  ) {
    printStackHelp(loaded);
    return 0;
  }

  const script = resolveStackScript(loaded);
  const result = spawnSync(script, args, {
    cwd: loaded.workspace,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

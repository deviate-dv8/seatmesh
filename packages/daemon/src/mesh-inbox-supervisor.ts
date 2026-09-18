#!/usr/bin/env node
/**
 * Mesh inbox supervisor — keeps mesh-inbox-server alive (crash restart + dist HMR)
 * for ONE mesh. Started by seatmesh --profile .sm engine (session up / reload /
 * ensureMeshInbox), not by hand.
 *
 * The watch/health/HMR state machine lives in mesh-inbox-watcher.ts so
 * mesh-inbox-host-supervisor.ts can run the same logic for many meshes inside one
 * host process — this file is now just the single-profile CLI entry over it.
 */
import { loadProfile } from "@seat-mesh/core";
import { createMeshWatcher } from "./mesh-inbox-watcher.js";

function parseArgs(): { profilePath?: string } {
  const out: { profilePath?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--profile" && argv[i + 1]) out.profilePath = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const { profilePath } = parseArgs();
  const loaded = loadProfile(profilePath);
  const watcher = createMeshWatcher(loaded);

  let exiting = false;
  const exit = (why: string) => {
    if (exiting) return;
    exiting = true;
    watcher.stop(why);
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", () => exit("SIGTERM"));
  process.on("SIGINT", () => exit("SIGINT"));
}

void main().catch((e) => {
  console.error(`mesh-inbox-supervisor fatal: ${(e as Error).message}`);
  process.exit(1);
});

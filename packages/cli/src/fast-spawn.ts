#!/usr/bin/env node
/**
 * Slim entry for `spawn` / `switch --fast` — must stay under 1s wall.
 * Leaf imports only (never package barrels / never full main.js).
 */
// @ts-nocheck
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDist = path.resolve(here, "../../core/dist");
const tmuxDist = path.resolve(here, "../../tmux/dist");

function usage(vocal) {
  console.error(
    vocal === "spawn"
      ? "usage: spawn <target|1..4> <agent|claude|opencode|kiro> [--fast|--keep-resume]"
      : "usage: switch <target|1..4> <cli|empty> [--fast] …",
  );
  process.exit(2);
}

function parseArgv(argv) {
  let profileArg;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--profile" || a === "-p") {
      profileArg = argv[++i];
      continue;
    }
    if (a.startsWith("--profile=")) {
      profileArg = a.slice("--profile=".length);
      continue;
    }
    args.push(a);
  }
  const vocalRaw = (args[0] ?? "spawn").toLowerCase();
  const vocal =
    vocalRaw === "handoff" ? "handoff" : vocalRaw === "switch" ? "switch" : "spawn";
  let fast = vocal === "spawn";
  if (args.length < 3) usage(vocal === "handoff" ? "switch" : vocal);
  const targetRaw = args[1];
  const newType = args[2];
  let fresh;
  let resumeId;
  const reasonParts = [];
  for (let i = 3; i < args.length; i++) {
    const a = args[i];
    if (a === "--fresh") fresh = true;
    else if (a === "--keep-resume" || a === "--no-fresh") fresh = false;
    else if (a === "--fast") fast = true;
    else if (a === "--slow" || a === "--verify") {
      console.error("fast-spawn: use full `seatmesh switch … --slow`");
      process.exit(2);
    } else if (a === "--resume" && args[i + 1]) resumeId = args[++i];
    else if (a.startsWith("--resume=")) resumeId = a.slice("--resume=".length);
    else if (a === "--queue") {
      console.error("fast-spawn: --queue not supported — use full seatmesh");
      process.exit(2);
    } else reasonParts.push(a);
  }
  if (!fast) {
    console.error("fast-spawn: only --fast (spawn default)");
    process.exit(2);
  }
  return {
    vocal,
    targetRaw,
    newType,
    fresh,
    resumeId,
    reason: reasonParts.join(" ") || undefined,
    profileArg,
  };
}

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
  const [
    { loadProfileFast },
    { expandTargetSpec, targetRangeOptsFromProfile },
    { runSwitchFast },
    { requireCoordRoleFast },
  ] = await Promise.all([
    import(pathToFileURL(path.join(coreDist, "profile/profile.js")).href),
    import(pathToFileURL(path.join(coreDist, "comms/target-range.js")).href),
    import(pathToFileURL(path.join(tmuxDist, "agents/switch-fast.js")).href),
    import(pathToFileURL(path.join(tmuxDist, "agents/authz-fast.js")).href),
  ]);

  // Skip applyMeshState scrape — yaml path in loadProfile is enough for paste.
  const loaded = loadProfileFast(parsed.profileArg);
  requireCoordRoleFast(loaded, parsed.vocal === "spawn" ? "switch" : parsed.vocal);
  const targets = expandTargetSpec(
    parsed.targetRaw,
    targetRangeOptsFromProfile(loaded.profile),
  );
  for (const t of targets) {
    runSwitchFast(loaded, t, parsed.newType, {
      fresh: parsed.fresh,
      resumeId: parsed.resumeId,
      reason: parsed.reason,
    });
  }
  if (targets.length > 1) {
    console.log(`ok fanout ${parsed.vocal} → ${targets.join(",")} (${targets.length})`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

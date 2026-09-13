#!/usr/bin/env node
// Pre-publish helper: copy the canonical profiles/minimal tree into the CLI package
// so a published `seatmesh` ships its default profile. Node 22.6+/24 strips the TS
// types at runtime, so this runs as `node scripts/bundle-profiles.ts` with no build step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot: string = path.resolve(cliRoot, "../..");
const src: string = path.join(repoRoot, "profiles/minimal");
const dest: string = path.join(cliRoot, "profiles/minimal");

if (!fs.existsSync(src)) {
  console.error(`bundle-profiles: missing ${src}`);
  process.exit(1);
}

fs.rmSync(path.join(cliRoot, "profiles"), { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`bundle-profiles: ${src} -> ${dest}`);

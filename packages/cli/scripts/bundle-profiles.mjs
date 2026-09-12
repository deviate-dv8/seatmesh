#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliRoot, "../..");
const src = path.join(repoRoot, "profiles/minimal");
const dest = path.join(cliRoot, "profiles/minimal");

if (!fs.existsSync(src)) {
  console.error(`bundle-profiles: missing ${src}`);
  process.exit(1);
}

fs.rmSync(path.join(cliRoot, "profiles"), { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`bundle-profiles: ${src} -> ${dest}`);

#!/usr/bin/env node
/**
 * Copy greppable CLI docs into the package so `seatmesh update` can sync them
 * into each profile's `.sm/docs/` (npx/global installs don't have the git tree).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliRoot, "../..");
const srcDocs = path.join(repoRoot, "docs");
const destDocs = path.join(cliRoot, "templates", "docs");

function mustExist(p: string): void {
  if (!fs.existsSync(p)) {
    console.error(`bundle-docs: missing ${p}`);
    process.exit(1);
  }
}

mustExist(path.join(srcDocs, "cli"));
mustExist(path.join(srcDocs, "COMMANDS.md"));

fs.rmSync(destDocs, { recursive: true, force: true });
fs.mkdirSync(destDocs, { recursive: true });
fs.cpSync(path.join(srcDocs, "cli"), path.join(destDocs, "cli"), { recursive: true });
fs.copyFileSync(path.join(srcDocs, "COMMANDS.md"), path.join(destDocs, "COMMANDS.md"));
for (const extra of ["ONE-PATH.md", "RELEASE.md"]) {
  const p = path.join(srcDocs, extra);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(destDocs, extra));
}
console.log(`bundle-docs: ${srcDocs}/cli + COMMANDS.md → ${destDocs}`);

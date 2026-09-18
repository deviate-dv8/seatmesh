#!/usr/bin/env bash
# Install seatmesh from npm, rewriting accidental file:../ workspace deps
# that currently ship on the published seatmesh package.
set -euo pipefail

VER="${1:-${SEATMESH_VERSION:-latest}}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"
echo "[lab] packing seatmesh@$VER …"
npm pack "seatmesh@$VER" >/dev/null
tar -xzf seatmesh-*.tgz
cd package

node <<'NODE'
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const ver = pkg.version;
const deps = pkg.dependencies || {};
for (const [k, v] of Object.entries(deps)) {
  if (typeof v === "string" && v.startsWith("file:")) {
    deps[k] = ver;
    console.log(`[lab] rewrite ${k}: ${v} → ${ver}`);
  }
}
pkg.dependencies = deps;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
NODE

echo "[lab] npm install -g (rewritten) seatmesh@$VER"
npm install -g .
seatmesh --version || true

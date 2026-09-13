#!/usr/bin/env bash
# Publish @seat-mesh/* then seatmesh CLI (same version in every package.json).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

unset npm_config_prefix NPM_CONFIG_PREFIX

npm run build

ORDER=(
  packages/core
  packages/providers
  packages/tmux
  packages/connectivity
  packages/daemon
  packages/cli
)

for dir in "${ORDER[@]}"; do
  echo "publish: $dir"
  npm publish -w "$(basename "$dir")" --access public
done

echo "done: npm view seatmesh version"

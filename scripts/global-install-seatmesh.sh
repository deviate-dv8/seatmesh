#!/usr/bin/env bash
# Install seatmesh CLI on the real global prefix (not a repo-local npm prefix).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="${1:-latest}"

# Inherited from npm/npx in this workspace — breaks `npm install -g` (EEXIST on bin/seatmesh).
unset npm_config_prefix NPM_CONFIG_PREFIX

if [[ "$VER" == "local" ]]; then
  echo "global-install: building + installing from $ROOT/packages/cli ..." >&2
  (cd "$ROOT" && npm run build)
  npm install -g "$ROOT/packages/cli"
else
  echo "global-install: npm install -g seatmesh@${VER} ..." >&2
  npm install -g "seatmesh@${VER}"
fi

echo "global-install: $(command -v seatmesh)" >&2
seatmesh --help | head -3

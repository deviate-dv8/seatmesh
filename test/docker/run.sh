#!/usr/bin/env bash
# seatmesh docker test runner — isolated container, source COPYed in (no host
# node_modules/tmux/mesh state touched). Rebuilds the image each run (cached
# layers keep it fast unless package.json/package-lock.json changed).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.yml")

usage() {
  cat <<EOF
seatmesh docker test runner

  ./test/docker/run.sh [test]         build (dist) + vitest test:ci (default)
  ./test/docker/run.sh test:all       vitest run (incl. sqlite-store.test.ts)
  ./test/docker/run.sh typecheck      tsc --noEmit across workspaces (not web)
  ./test/docker/run.sh build          npm run build only
  ./test/docker/run.sh ci             build + typecheck + test:ci
  ./test/docker/run.sh shell          interactive bash in the built image
EOF
}

cmd="${1:-test}"
[[ "$cmd" == "-h" || "$cmd" == "--help" ]] && { usage; exit 0; }

"${COMPOSE[@]}" build
"${COMPOSE[@]}" run --rm seatmesh-test "$cmd"

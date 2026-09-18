#!/usr/bin/env bash
# seatmesh docker CI runner. `./test/docker/run.sh <cmd>` drives this from the host.
set -euo pipefail
cd /work

case "${1:-test}" in
  test)
    npm run build
    npm run test:ci
    ;;
  test:all)
    # Includes sqlite-store.test.ts (native better-sqlite3 build, image-local).
    npm run build
    npx vitest run
    ;;
  typecheck)
    # Cross-workspace types resolve through each dep's built dist/ (file: deps,
    # not TS project references) — build first or a clean checkout 2307s on itself.
    # Workspaces only — @seat-mesh/web has pre-existing, unrelated tsc errors
    # (adonisjs auth typing) not wired to this build; core packages must stay clean.
    npm run build
    npm run typecheck -w @seat-mesh/core -w @seat-mesh/providers -w @seat-mesh/connectivity \
      -w @seat-mesh/tmux -w @seat-mesh/daemon -w seatmesh
    ;;
  build)
    npm run build
    ;;
  ci)
    npm run build
    npm run typecheck -w @seat-mesh/core -w @seat-mesh/providers -w @seat-mesh/connectivity \
      -w @seat-mesh/tmux -w @seat-mesh/daemon -w seatmesh
    npm run test:ci
    ;;
  shell)
    exec bash
    ;;
  *)
    exec "$@"
    ;;
esac

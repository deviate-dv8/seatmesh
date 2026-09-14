#!/usr/bin/env bash
# RETIRED wrapper. Agents/docs must use: seatmesh --profile .sm …
echo "DEPRECATED: ./sm.sh is retired — use: seatmesh --profile .sm $*" >&2
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="$ROOT/.sm"
[[ -f "$PROFILE/mesh.config.yaml" ]] || {
  echo "missing $PROFILE/mesh.config.yaml" >&2
  exit 1
}
exec npx --prefix "$ROOT" --no seatmesh -- --profile "$PROFILE" "$@"

#!/usr/bin/env bash
# RETIRED workspace wrapper. Prefer the `sm` alias (PATH after `sm install`).
echo "DEPRECATED: ./sm.sh is retired — use: sm $*" >&2
echo "  install: sm install   # or: seatmesh install  → ~/.local/bin/{sm,seatmesh}" >&2
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="$ROOT/.sm"
[[ -f "$PROFILE/mesh.config.yaml" ]] || {
  echo "missing $PROFILE/mesh.config.yaml" >&2
  exit 1
}
# Prefer installed `sm` when available; else npx seatmesh (compat).
if command -v sm >/dev/null 2>&1; then
  exec sm --profile "$PROFILE" "$@"
fi
exec npx --prefix "$ROOT" --no seatmesh -- --profile "$PROFILE" "$@"

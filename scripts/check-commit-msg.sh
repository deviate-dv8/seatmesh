#!/usr/bin/env bash
# Usage: check-commit-msg.sh [path-to-commit-msg-file]
set -euo pipefail
f="${1:-}"
[[ -n "$f" && -f "$f" ]] || exit 0
text="$(cat "$f")"
if echo "$text" | rg -qi 'co-authored-by:|generated with (cursor|claude)|zsign-api|zsign-app|/home/dan|tasks/seat-mesh/'; then
  echo "COMMIT REJECTED: seat-mesh commits must stay product-neutral (see docs/COMMITS.md)" >&2
  exit 1
fi

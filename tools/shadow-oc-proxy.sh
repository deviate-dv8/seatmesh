#!/usr/bin/env bash
# DEPRECATED — CPE sources landed on main as opencode-cpe-*.
# Kept only to clear leftover shadows / local hook until origin/oc-proxy is deleted.
#
# Usage:
#   tools/shadow-oc-proxy.sh clear    # remove shadows (needed before: git checkout oc-proxy)
#   tools/shadow-oc-proxy.sh status   # which shadows are present / dirty
#   tools/shadow-oc-proxy.sh apply    # no-op note (files already on main)
#   tools/shadow-oc-proxy.sh install  # local post-checkout hook → clear on main
#
# Tip: before switching to oc-proxy:  tools/shadow-oc-proxy.sh clear && git checkout oc-proxy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${OC_PROXY_REF:-origin/oc-proxy}"
ACTION="${1:-status}"

# Historical shadow paths (now tracked on main under opencode-cpe names).
SHADOW_PATHS=(
  packages/daemon/src/connectivity/oc-limit-v2.ts
  packages/daemon/src/connectivity/opencode-cpe-atomics.ts
  packages/daemon/src/connectivity/oc-relaunch.ts
  packages/daemon/src/connectivity/oc-resume-broadcast.eth.test.ts
  packages/tmux/src/agents/opencode-cpe-live.ts
  packages/tmux/src/agents/opencode-cpe-live.test.ts
  packages/tmux/src/agents/oc-stop.ts
  packages/tmux/src/agents/oc-stop.test.ts
  packages/tmux/src/agents/opencode-launch-sanitize.ts
  packages/tmux/src/agents/opencode-launch-sanitize.test.ts
  packages/tmux/src/agents/pane-resume.ts
  packages/tmux/src/agents/pane-resume.test.ts
  docs/patterns/opencode-cpe.md
  packages/cli/templates/docs/cli/opencode-cpe.md
  scripts/opencode-cpe-atomics.sh
  scripts/opencode-cpe-atomics.mjs
)

die() { echo "FAIL: $*" >&2; exit 1; }

ensure_ref() {
  git rev-parse --verify "$REF" >/dev/null 2>&1 || git fetch origin oc-proxy 2>/dev/null || true
  git rev-parse --verify "$REF" >/dev/null 2>&1 || die "missing $REF — run: git fetch origin oc-proxy"
}

is_tracked_here() {
  git ls-files --error-unmatch "$1" >/dev/null 2>&1
}

apply_shadows() {
  echo "note: CPE sources are on main (opencode-cpe-*). apply is a no-op."
  echo "      Use clear if you still have leftover untracked shadows."
  status_shadows
}

clear_shadows() {
  local p
  for p in "${SHADOW_PATHS[@]}"; do
    if [[ -e "$p" ]] && ! is_tracked_here "$p"; then
      rm -f "$p"
      echo "cleared $p"
    fi
  done
}

status_shadows() {
  local p present=0
  for p in "${SHADOW_PATHS[@]}"; do
    if [[ -e "$p" ]] && ! is_tracked_here "$p"; then
      echo "shadow ?? $p"
      present=1
    elif is_tracked_here "$p"; then
      echo "tracked  $p"
    fi
  done
  [[ "$present" -eq 0 ]] && echo "no leftover shadows"
}

install_hook() {
  local hook="$ROOT/.git/hooks/post-checkout"
  mkdir -p "$(dirname "$hook")"
  cat >"$hook" <<'HOOK'
#!/usr/bin/env bash
# Auto-clear oc-proxy shadows when landing on main (local hook — not committed).
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[[ -n "$root" && -x "$root/tools/shadow-oc-proxy.sh" ]] || exit 0
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "$branch" == "main" || "$branch" == "master" ]]; then
  "$root/tools/shadow-oc-proxy.sh" clear || true
fi
HOOK
  chmod +x "$hook"
  echo "installed $hook"
  echo "before checkout oc-proxy: tools/shadow-oc-proxy.sh clear"
}

case "$ACTION" in
  apply) apply_shadows ;;
  clear) clear_shadows ;;
  status) status_shadows ;;
  install) install_hook ;;
  *) die "usage: $0 apply|clear|status|install" ;;
esac

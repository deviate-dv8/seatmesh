#!/usr/bin/env bash
# Shadow oc-proxy-only sources onto the current working tree as UNTRACKED files.
# Not committed on main, not listed in .gitignore — they show as ?? and keep tsc/report alive.
#
# Usage:
#   tools/shadow-oc-proxy.sh apply    # materialize from origin/oc-proxy (default)
#   tools/shadow-oc-proxy.sh clear    # remove shadows (needed before: git checkout oc-proxy)
#   tools/shadow-oc-proxy.sh status   # which shadows are present / dirty
#   tools/shadow-oc-proxy.sh install  # local post-checkout hook → apply on main
#
# Tip: before switching to oc-proxy:  tools/shadow-oc-proxy.sh clear && git checkout oc-proxy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REF="${OC_PROXY_REF:-origin/oc-proxy}"
ACTION="${1:-apply}"

# Added-on-oc-proxy paths only (skip files already tracked on main, e.g. oc-resume-broadcast.ts).
SHADOW_PATHS=(
  packages/daemon/src/connectivity/oc-limit-v2.ts
  packages/daemon/src/connectivity/oc-proxy-atomics.ts
  packages/daemon/src/connectivity/oc-relaunch.ts
  packages/daemon/src/connectivity/oc-resume-broadcast.eth.test.ts
  packages/tmux/src/agents/oc-proxy-live.ts
  packages/tmux/src/agents/oc-proxy-live.test.ts
  packages/tmux/src/agents/oc-stop.ts
  packages/tmux/src/agents/oc-stop.test.ts
  packages/tmux/src/agents/opencode-launch-sanitize.ts
  packages/tmux/src/agents/opencode-launch-sanitize.test.ts
  packages/tmux/src/agents/pane-resume.ts
  packages/tmux/src/agents/pane-resume.test.ts
  docs/patterns/oc-proxy.md
  packages/cli/templates/docs/cli/oc-proxy.md
  scripts/oc-proxy-atomics.sh
  scripts/oc-proxy-atomics.mjs
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
  ensure_ref
  local p n=0 skip=0
  for p in "${SHADOW_PATHS[@]}"; do
    if is_tracked_here "$p"; then
      echo "skip tracked $p"
      skip=$((skip + 1))
      continue
    fi
    mkdir -p "$(dirname "$p")"
    git show "$REF:$p" >"$p"
    # scripts/ is repo-gitignored; chmod still useful
    [[ "$p" == *.sh ]] && chmod +x "$p" || true
    echo "shadow $p"
    n=$((n + 1))
  done
  echo "OK: shadowed $n file(s) from $REF (skipped tracked=$skip)"
  echo "note: untracked on this branch — do not git add (or use oc-proxy branch)"
}

clear_shadows() {
  local p n=0
  for p in "${SHADOW_PATHS[@]}"; do
    if is_tracked_here "$p"; then
      continue
    fi
    if [[ -e "$p" || -L "$p" ]]; then
      rm -f "$p"
      echo "clear $p"
      n=$((n + 1))
    fi
  done
  echo "OK: cleared $n shadow file(s)"
}

status_shadows() {
  ensure_ref
  local p
  for p in "${SHADOW_PATHS[@]}"; do
    if is_tracked_here "$p"; then
      printf 'tracked  %s\n' "$p"
    elif [[ -f "$p" ]]; then
      if git show "$REF:$p" 2>/dev/null | cmp -s - "$p"; then
        printf 'shadow   %s (= %s)\n' "$p" "$REF"
      else
        printf 'shadow*  %s (differs from %s)\n' "$p" "$REF"
      fi
    else
      printf 'missing  %s\n' "$p"
    fi
  done
}

install_hook() {
  local hook="$ROOT/.git/hooks/post-checkout"
  mkdir -p "$(dirname "$hook")"
  cat >"$hook" <<'HOOK'
#!/usr/bin/env bash
# Auto-shadow oc-proxy sources when landing on main (local hook — not committed).
prev=$1
new=$2
flag=$3
[[ "$flag" == "1" ]] || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
root=$(git rev-parse --show-toplevel 2>/dev/null || true)
[[ -n "$root" && -x "$root/tools/shadow-oc-proxy.sh" ]] || exit 0
case "$branch" in
  main|master)
    "$root/tools/shadow-oc-proxy.sh" apply || true
    ;;
esac
HOOK
  chmod +x "$hook"
  echo "OK: installed $hook (applies shadows after checkout → main)"
  echo "before checkout oc-proxy: tools/shadow-oc-proxy.sh clear"
}

case "$ACTION" in
  apply | on) apply_shadows ;;
  clear | off | rm) clear_shadows ;;
  status | ls) status_shadows ;;
  install) install_hook ;;
  -h | --help | help)
    sed -n '2,16p' "$0"
    ;;
  *)
    die "unknown action '$ACTION' (apply|clear|status|install)"
    ;;
esac

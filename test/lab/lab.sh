#!/usr/bin/env bash
# Seatmesh lab — isolated container for upgrade tests / poke-around.
# Does NOT touch host pia/zsign/seatmesh sessions or ~/.config meshes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f "$ROOT/docker-compose.yml")
SSH_PORT="${LAB_SSH_PORT:-2222}"
KEYS_DIR="$ROOT/keys"
KEY_PRIV="$KEYS_DIR/lab_ed25519"
KEY_PUB="$KEYS_DIR/lab_ed25519.pub"
AUTH_KEYS="$KEYS_DIR/authorized_keys"

ensure_keys() {
  mkdir -p "$KEYS_DIR"
  if [[ ! -f "$KEY_PRIV" ]]; then
    ssh-keygen -t ed25519 -N "" -f "$KEY_PRIV" -C "seatmesh-lab" >/dev/null
    echo "[lab] generated $KEY_PRIV"
  fi
  cp "$KEY_PUB" "$AUTH_KEYS"
  chmod 600 "$KEY_PRIV" "$AUTH_KEYS" 2>/dev/null || true
  chmod 644 "$KEY_PUB" "$AUTH_KEYS"
}

wait_ssh() {
  local i=0
  while (( i < 60 )); do
    if ssh -i "$KEY_PRIV" -o BatchMode=yes -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null -o ConnectTimeout=1 \
      -p "$SSH_PORT" lab@127.0.0.1 'true' 2>/dev/null; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "[lab] ssh not ready on :$SSH_PORT" >&2
  return 1
}

ssh_cmd() {
  ensure_keys
  ssh -i "$KEY_PRIV" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -p "$SSH_PORT" lab@127.0.0.1 "$@"
}

usage() {
  cat <<EOF
seatmesh lab (isolated upgrade / poke container)

  ./lab.sh up [version]     build+start (default seatmesh@1.2.5)
  ./lab.sh down             stop (keep volume)
  ./lab.sh wipe             stop + delete lab HOME volume
  ./lab.sh ssh              interactive shell
  ./lab.sh attach           tmux attach lab session (if started)
  ./lab.sh exec <cmd…>      run command as lab
  ./lab.sh start-mesh       seatmesh start inside lab
  ./lab.sh upgrade [ver]    npm i -g seatmesh@ver + seatmesh update
  ./lab.sh status           container + seatmesh version
  ./lab.sh logs             follow container logs

Host ports: SSH ${SSH_PORT}  inbox 31691  hub 3191
Password fallback: lab / seatmesh-lab
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  up)
    ver="${1:-${SEATMESH_VERSION:-1.2.5}}"
    ensure_keys
    export SEATMESH_VERSION="$ver"
    export LAB_INSTALL="${LAB_INSTALL:-npm}"
    echo "[lab] building seatmesh-lab@$ver (LAB_INSTALL=$LAB_INSTALL) …"
    "${COMPOSE[@]}" build --build-arg "SEATMESH_VERSION=$ver" --build-arg "LAB_BAKE_NPM=1"
    "${COMPOSE[@]}" up -d
    wait_ssh
    echo
    echo "SSH in:"
    echo "  $ROOT/lab.sh ssh"
    echo "  ssh -i $KEY_PRIV -p $SSH_PORT lab@127.0.0.1"
    echo "  # or: ssh -p $SSH_PORT lab@127.0.0.1   (password: seatmesh-lab)"
    echo
    echo "Then: cd ~/mesh && seatmesh session up && seatmesh inbox restart"
    echo "Upgrade drill: $ROOT/lab.sh upgrade latest"
    ;;
  down)
    "${COMPOSE[@]}" down
    ;;
  wipe)
    "${COMPOSE[@]}" down -v
    echo "[lab] volume wiped — next up re-seeds ~/mesh"
    ;;
  ssh)
    ensure_keys
    wait_ssh
    exec ssh -i "$KEY_PRIV" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -t -p "$SSH_PORT" lab@127.0.0.1
    ;;
  attach)
    ensure_keys
    wait_ssh
    exec ssh -i "$KEY_PRIV" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -t -p "$SSH_PORT" lab@127.0.0.1 'cd ~/mesh && tmux attach -t lab || tmux attach'
    ;;
  exec)
    ensure_keys
    wait_ssh
    if [[ $# -eq 0 ]]; then
      echo "usage: lab.sh exec <cmd…>" >&2
      exit 2
    fi
    ssh_cmd "$@"
    ;;
  start-mesh)
    ensure_keys
    wait_ssh
    # session up (no attach) — start tries to open a terminal and fails under BatchMode ssh
    ssh_cmd 'cd ~/mesh && SEATMESH_SKIP_VERSION_CHECK=1 seatmesh session up && SEATMESH_SKIP_VERSION_CHECK=1 seatmesh inbox restart; tmux ls; seatmesh session status'
    ;;
  upgrade)
    ver="${1:-latest}"
    ensure_keys
    wait_ssh
    echo "[lab] install seatmesh@$ver (rewrites file: deps) + update"
    # Prefer in-container rewrite installer — plain npm i -g seatmesh is broken
    # while published package.json still lists file:../ workspace deps.
    ssh_cmd "sudo /usr/local/bin/lab-install-from-npm.sh '$ver' && cd ~/mesh && SEATMESH_SKIP_VERSION_CHECK=1 seatmesh update && seatmesh --version"
    ;;
  status)
    ensure_keys
    "${COMPOSE[@]}" ps
    if docker inspect seatmesh-lab >/dev/null 2>&1; then
      echo "---"
      ssh_cmd 'seatmesh --version; cd ~/mesh && ls -la .sm 2>/dev/null | head -5 || echo "(no .sm yet)"' || true
    fi
    ;;
  logs)
    "${COMPOSE[@]}" logs -f
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "unknown: $cmd" >&2
    usage >&2
    exit 2
    ;;
esac

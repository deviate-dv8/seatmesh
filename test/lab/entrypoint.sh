#!/usr/bin/env bash
# Lab entrypoint: wire seatmesh, seed isolated mesh, sshd (always).
set -euo pipefail

LAB_HOME="${LAB_HOME:-/home/lab}"
LAB_MESH="${LAB_MESH:-/home/lab/mesh}"
LAB_INBOX_PORT="${LAB_INBOX_PORT:-31691}"
LAB_INSTALL="${LAB_INSTALL:-npm}"
SEATMESH_VERSION="${SEATMESH_VERSION:-1.2.5}"

mkdir -p "$LAB_HOME/.ssh" "$LAB_MESH"
# authorized_keys may be a read-only bind — never fail the boot on chown
find "$LAB_HOME" \( -path "$LAB_HOME/.ssh/authorized_keys" -o -path "$LAB_HOME/.ssh" \) -prune \
  -o -print0 2>/dev/null | xargs -0 -r chown lab:lab 2>/dev/null || true
chown lab:lab "$LAB_HOME" "$LAB_MESH" 2>/dev/null || true
chmod 700 "$LAB_HOME/.ssh" || true

wire_seatmesh() {
  # Prefer baked/global npm install. Only fall back to monorepo bin when asked.
  if [[ "$LAB_INSTALL" == "workspace" ]]; then
    if [[ -x /opt/seatmesh/bin/seatmesh ]]; then
      ln -sfn /opt/seatmesh/bin/seatmesh /usr/local/bin/seatmesh
      if [[ -x /opt/seatmesh/bin/sm ]]; then
        ln -sfn /opt/seatmesh/bin/sm /usr/local/bin/sm
      else
        ln -sfn /opt/seatmesh/bin/seatmesh /usr/local/bin/sm
      fi
      echo "[lab] wired workspace bin → /usr/local/bin/seatmesh (node-pty may break inbox)"
    else
      echo "[lab] WARN: /opt/seatmesh/bin/seatmesh missing" >&2
    fi
    return 0
  fi
  if ! command -v seatmesh >/dev/null 2>&1; then
    if [[ -x /usr/local/bin/lab-install-from-npm.sh ]]; then
      /usr/local/bin/lab-install-from-npm.sh "$SEATMESH_VERSION" || \
        echo "[lab] WARN: npm install failed" >&2
    fi
  fi
}

wire_seatmesh

seed_mesh() {
  if [[ -d "$LAB_MESH/.sm" ]]; then
    return 0
  fi
  echo "[lab] seeding workspace at $LAB_MESH"
  if ! su - lab -c "cd '$LAB_MESH' && SEATMESH_SKIP_VERSION_CHECK=1 seatmesh init --name lab"; then
    echo "[lab] WARN: seatmesh init failed (SSH still up — fix CLI then re-seed)" >&2
    return 0
  fi
  if [[ -f /opt/lab-seed/mesh.config.yaml ]]; then
    cp /opt/lab-seed/mesh.config.yaml "$LAB_MESH/.sm/mesh.config.yaml"
    chown lab:lab "$LAB_MESH/.sm/mesh.config.yaml"
  fi
  echo "[lab] seed done — inbox :${LAB_INBOX_PORT}. Next: seatmesh start"
}

seed_mesh || true

cat > /etc/motd <<EOF
seatmesh lab (isolated HOME + .sm — not your host meshes)
  mode: ${LAB_INSTALL}   version pin: ${SEATMESH_VERSION}
  cd ~/mesh && seatmesh whoami
  seatmesh start
  host: ./lab.sh ssh   |   ssh -p 2222 lab@127.0.0.1  (lab / seatmesh-lab)
  inbox :${LAB_INBOX_PORT}  hub host :3191
EOF

echo "[lab] seatmesh $(su - lab -c 'cd ~/mesh && seatmesh version' 2>/dev/null | head -1 || echo '?')"
echo "[lab] sshd on :22"
exec /usr/sbin/sshd -D -e

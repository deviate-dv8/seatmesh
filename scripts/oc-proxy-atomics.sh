#!/usr/bin/env bash
# OC-proxy atomics (all hub meshes): record → kill CPE OC → revive oc-proxy → CONTINUE.
#
# Usage:
#   ./scripts/oc-proxy-atomics.sh              # full roundtrip (default)
#   ./scripts/oc-proxy-atomics.sh roundtrip    # same
#   ./scripts/oc-proxy-atomics.sh record       # snapshot ses_* only
#   ./scripts/oc-proxy-atomics.sh kill         # kill stamped CPE OC → zsh
#   ./scripts/oc-proxy-atomics.sh revive       # revive-from-stamp + CONTINUE
#
# Env:
#   OC_PROXY_ATOMICS_MESHES     space-separated (default: pia zsign seatmesh)
#   OC_PROXY_CONTINUE_WAIT_SEC  wait before CONTINUE inject (default 12)
#   OC_PROXY_RETRY_WAIT_SEC     retry wait for dead panes (default 10)
#   CPE_PROXY_PORT              proxy port (default 18887)
#
# Logs: /tmp/seatmesh-oc-atomics-child.log
# Stamp: /tmp/seatmesh-oc-proxy-sessions.json
# Pending: /tmp/seatmesh-oc-atomics-pending.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MJS="$ROOT/scripts/oc-proxy-atomics.mjs"
STAMP="${OC_PROXY_SES_STAMP:-/tmp/seatmesh-oc-proxy-sessions.json}"
PENDING="${OC_PROXY_ATOMICS_PENDING:-/tmp/seatmesh-oc-atomics-pending.json}"
LOCK="${OC_PROXY_ATOMICS_LOCK:-/tmp/seatmesh-oc-atomics.lock}"
LOG="${OC_PROXY_ATOMICS_LOG:-/tmp/seatmesh-oc-atomics-child.log}"
PORT="${CPE_PROXY_PORT:-18887}"
MESHES="${OC_PROXY_ATOMICS_MESHES:-pia zsign seatmesh}"
ACTION="${1:-roundtrip}"

die() { echo "FAIL: $*" >&2; exit 1; }
[[ -f "$MJS" ]] || die "missing $MJS"

clear_stale_lock() {
  [[ -f "$LOCK" ]] || return 0
  local old
  old="$(tr -d '[:space:]' <"$LOCK" 2>/dev/null || true)"
  if [[ -n "$old" && "$old" =~ ^[0-9]+$ ]] && kill -0 "$old" 2>/dev/null; then
    die "atomics already running pid=$old (lock=$LOCK)"
  fi
  echo "clearing stale lock pid=${old:-?} → $LOCK"
  rm -f "$LOCK"
}

proxy_ip() {
  curl -sS --max-time 8 -x "http://127.0.0.1:${PORT}" https://api.ipify.org 2>/dev/null \
    | tr -d '[:space:]' || true
}

run_mjs() {
  node "$MJS" "$@"
}

record_all() {
  local m tmpdir
  tmpdir="$(mktemp -d /tmp/seatmesh-oc-atomics-record.XXXXXX)"
  trap 'rm -rf "$tmpdir"' RETURN

  for m in $MESHES; do
    run_mjs record "$m" all-oc-proxy
    cp -f "$STAMP" "$tmpdir/$m.json"
  done

  local ip
  ip="$(proxy_ip)"
  [[ -n "$ip" ]] || ip="0.0.0.0"

  node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";

const stampPath = process.argv[1];
const pendingPath = process.argv[2];
const dir = process.argv[3];
const ip = process.argv[4] || "0.0.0.0";
const port = Number(process.argv[5] || 18887);

const seats = [];
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  seats.push(...(d.seats || []));
}
const merged = { at: new Date().toISOString(), which: "all-oc-proxy", seats };
fs.writeFileSync(stampPath, JSON.stringify(merged, null, 2));
fs.writeFileSync(
  pendingPath,
  JSON.stringify(
    { fromIp: ip, toIp: ip, proxyPort: port, seats, startedAt: new Date().toISOString() },
    null,
    2,
  ),
);
const by = {};
for (const s of seats) by[s.mesh] = (by[s.mesh] || 0) + 1;
console.log(
  `MERGED seats=${seats.length} [${Object.entries(by)
    .map(([m, n]) => `${m}:${n}`)
    .join(" ")}] ip=${ip}`,
);
' "$STAMP" "$PENDING" "$tmpdir" "$ip" "$PORT"
}

kill_all() {
  local m
  [[ -f "$STAMP" ]] || die "no stamp — run record first ($STAMP)"
  for m in $MESHES; do
    run_mjs kill "$m" all-oc-proxy
  done
}

revive_all() {
  [[ -f "$PENDING" ]] || die "no pending stamp — run record first ($PENDING)"
  clear_stale_lock
  export OC_PROXY_CONTINUE_WAIT_SEC="${OC_PROXY_CONTINUE_WAIT_SEC:-12}"
  export OC_PROXY_RETRY_WAIT_SEC="${OC_PROXY_RETRY_WAIT_SEC:-10}"
  echo "revive-from-stamp → log=$LOG (continue_wait=${OC_PROXY_CONTINUE_WAIT_SEC}s)"
  # Foreground so caller sees DONE; lock prevents overlap.
  run_mjs --revive-from-stamp "$PENDING" | tee -a "$LOG"
}

roundtrip() {
  clear_stale_lock
  : >"$LOG"
  record_all
  kill_all
  echo "KILL done — sleeping 2s before revive"
  sleep 2
  revive_all
}

case "$ACTION" in
  record) record_all ;;
  kill) kill_all ;;
  revive) revive_all ;;
  roundtrip | all) roundtrip ;;
  -h | --help | help)
    sed -n '2,22p' "$0"
    exit 0
    ;;
  *)
    die "unknown action '$ACTION' (record|kill|revive|roundtrip)"
    ;;
esac

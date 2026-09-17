import { spawnSync } from "node:child_process";
import { loadProfile, resolveDaemonPort, type LoadedProfile } from "@seat-mesh/core";
import type { ResumeWaveMeta } from "./oc-resume.js";

/**
 * Direct host egress IP — uses the first UP non-loopback interface that is NOT on the CPE
 * LAN subnet (192.168.100.x) and NOT a docker/bridge interface.
 * Falls back through eno1 → enx* (sorted) → wlo1 as last resort.
 * Returns null when no usable interface found.
 */
export function syncDirectIp(workspace: string): string | null {
  // Auto-detect: pick first UP iface that isn't CPE-subnet or docker bridge.
  // We shell out once to get the routing + bind in one shot.
  const r = spawnSync(
    "bash",
    [
      "-c",
      // Try each candidate interface in preference order; stop on first that returns a valid IP.
      // Exclude interfaces on 192.168.100.0/24 (CPE LAN) and loopback.
      `env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u ALL_PROXY -u all_proxy bash -c '
        for iface in eno1 $(ip -o link show up | awk -F": " "{print \\$2}" | grep -v "^lo\\|^wlo\\|^docker\\|^br-\\|^veth"); do
          ip=$(ip -4 addr show "$iface" 2>/dev/null | awk "/inet /{print \\$2}" | cut -d/ -f1 | head -1)
          [ -z "$ip" ] && continue
          echo "$ip" | grep -qE "^192\\.168\\.100\\." && continue
          result=$(curl --interface "$iface" -4 -sS -m 10 https://api.ipify.org 2>/dev/null)
          [ "$(printf "%s" "$result" | wc -c)" -ge 7 ] && echo "$result" && break
        done
      '`,
    ],
    { cwd: workspace, encoding: "utf8", timeout: 25_000 },
  );
  const ip = (r.stdout || "").trim();
  return ip.length >= 7 ? ip : null;
}

/**
 * via == eth means gost steers egress through the host wired LAN instead of the CPE —
 * not a real carrier rotation, so the caller must treat it as no carrier (ignore eth).
 * Returns false when eth is null (no usable direct iface — CPE is not "eth fallback").
 */
export function isViaEth(via: string | null, eth: string | null): boolean {
  return Boolean(via && eth && via === eth);
}

/** Blocking ipify via local gost — use after wait-ip / smart-restart before resume wave. */
export function syncCarrierIpProbe(workspace: string, proxyPort: number): string | null {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `HTTPS_PROXY=http://127.0.0.1:${proxyPort} HTTP_PROXY=http://127.0.0.1:${proxyPort} ` +
        `curl -4 -sS -m 25 https://api.ipify.org 2>/dev/null || ` +
        `curl -4 -sS -m 25 https://ifconfig.me/ip 2>/dev/null || true`,
    ],
    { cwd: workspace, encoding: "utf8", timeout: 35_000 },
  );
  const ip = (r.stdout || "").trim();
  if (ip.length < 7) return null;
  return isViaEth(ip, syncDirectIp(workspace)) ? null : ip;
}

export interface RemoteOcResumeBody {
  reason: string;
  fromIp?: string | null;
  toIp?: string | null;
  /** Profile name of the inbox that initiated the wave (loop guard). */
  source?: string;
}

function postJson(port: number, pathname: string, body: unknown): Record<string, unknown> | null {
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "12",
      "-X",
      "POST",
      `http://127.0.0.1:${port}${pathname}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}") as Record<string, unknown>;
  } catch {
    return { raw: r.stdout };
  }
}

/** Trigger OC resume on a foreign mesh inbox (same host, `remotes` profile path). */
export function postRemoteOcResume(
  remoteProfilePath: string,
  body: RemoteOcResumeBody,
): { ok: boolean; port?: number; detail?: unknown } {
  let loaded: LoadedProfile;
  try {
    loaded = loadProfile(remoteProfilePath);
  } catch {
    return { ok: false, detail: "load-profile-failed" };
  }
  const port = resolveDaemonPort(loaded.profile, loaded.workspace);
  const resp = postJson(port, "/connectivity/oc-resume", body);
  if (!resp || resp.ok !== true) {
    return { ok: false, port, detail: resp ?? "curl-failed" };
  }
  return { ok: true, port, detail: resp };
}

/** After local resume, fan out to every configured remote mesh (e.g. zsign <-> seatmesh). */
export function broadcastOcResumeToRemotes(
  loaded: LoadedProfile,
  reason: string,
  meta: ResumeWaveMeta | undefined,
  log: (line: string) => void,
): void {
  const remotes = loaded.profile.remotes;
  if (!remotes || !Object.keys(remotes).length) return;
  const source = loaded.profile.name ?? "mesh";
  const body: RemoteOcResumeBody = {
    reason,
    fromIp: meta?.fromIp ?? null,
    toIp: meta?.toIp ?? null,
    source,
  };
  for (const [alias, cfg] of Object.entries(remotes)) {
    const r = postRemoteOcResume(cfg.profile, body);
    if (r.ok) {
      log(`OC-RESUME broadcast @${alias} ok port=${r.port} reason=${reason}`);
    } else {
      log(`OC-RESUME broadcast @${alias} FAIL port=${r.port ?? "?"} detail=${JSON.stringify(r.detail)}`);
    }
  }
}

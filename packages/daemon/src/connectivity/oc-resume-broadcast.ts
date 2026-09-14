import { spawnSync } from "node:child_process";
import { loadProfile, resolveDaemonPort, type LoadedProfile } from "@seat-mesh/core";
import type { ResumeWaveMeta } from "./oc-resume.js";

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
  return ip.length >= 7 ? ip : null;
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

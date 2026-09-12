import net from "node:net";
import { spawnSync } from "node:child_process";
import type { MeshProfile } from "seat-mesh-core";

export async function proxyListenOkAsync(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(2000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

export async function fetchCarrierIp(proxyPort: number): Promise<string | null> {
  const proxy = `http://127.0.0.1:${proxyPort}`;
  const r = spawnSync(
    "curl",
    [
      "-4",
      "-sS",
      "-m",
      "12",
      "-x",
      proxy,
      "https://api.ipify.org",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const ip = (r.stdout ?? "").trim();
  return ip || null;
}

export async function snapshotConnectivity(
  profile: MeshProfile,
): Promise<import("./types.js").ConnectivitySnapshot> {
  const conn = profile.connectivity;
  const enabled = conn?.enabled ?? false;
  const port = conn?.proxyPort ?? 18887;
  const policy = conn?.policy ?? {
    rebootWifiBounce: false,
    smartRestart: false,
    rotateMaxAttempts: 3,
    cooldownMs: 1_800_000,
    ipifyFailBeforeRecovery: 3,
  };
  const ipifyAttempts = policy.ipifyFailBeforeRecovery ?? 3;

  const listen = enabled ? await proxyListenOkAsync(port) : false;
  let carrierIp: string | null = null;
  let ipifyFailStreak = 0;
  if (enabled && listen) {
    for (let i = 0; i < ipifyAttempts; i++) {
      carrierIp = await fetchCarrierIp(port);
      if (carrierIp) {
        ipifyFailStreak = 0;
        break;
      }
      ipifyFailStreak = i + 1;
      if (i + 1 < ipifyAttempts) {
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }

  const pendingTriggers: string[] = [];
  if (!enabled) {
    pendingTriggers.push("connectivity disabled in profile");
  } else if (!listen) {
    pendingTriggers.push("proxy not listening");
  } else if (!carrierIp) {
    pendingTriggers.push(
      `ipify failed through proxy (${ipifyFailStreak}/${ipifyAttempts} probes)`,
    );
  }

  return {
    mock: false,
    proxyPort: port,
    proxyListen: listen,
    carrierIp,
    carrierState: carrierIp ? "up" : listen ? "down" : "down",
    proxyState: listen ? (carrierIp ? "listen_ok" : "ipify_fail") : "down",
    policy,
    pendingTriggers,
  };
}

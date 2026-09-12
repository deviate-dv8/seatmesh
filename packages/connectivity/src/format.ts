import type { ConnectivitySnapshot } from "./types.js";

export function formatStatus(s: ConnectivitySnapshot): string {
  const lines = [
    `proxy: port=${s.proxyPort} listen=${s.proxyListen} state=${s.proxyState}${s.mock ? " (mock)" : ""}`,
    `carrier: ip=${s.carrierIp ?? "-"} state=${s.carrierState}`,
    `policy: wifiBounce=${s.policy.rebootWifiBounce} smartRestart=${s.policy.smartRestart} rotateMax=${s.policy.rotateMaxAttempts} cooldownMs=${s.policy.cooldownMs} ipifyFailBeforeRecovery=${s.policy.ipifyFailBeforeRecovery}`,
  ];
  if (s.pendingTriggers.length) {
    lines.push("pending:");
    for (const t of s.pendingTriggers) lines.push(`  - ${t}`);
  } else {
    lines.push("pending: (none)");
  }
  return lines.join("\n");
}

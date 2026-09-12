export type CarrierState = "up" | "down" | "cooldown" | "rotating";
export type ProxyState = "listen_ok" | "down" | "ipify_fail";
export type PaneTransport = "ok" | "limit" | "connect_err" | "proxy_down";

export interface ConnectivitySnapshot {
  mock: boolean;
  proxyPort: number;
  proxyListen: boolean;
  carrierIp: string | null;
  carrierState: CarrierState;
  proxyState: ProxyState;
  policy: {
    rebootWifiBounce: boolean;
    smartRestart: boolean;
    rotateMaxAttempts: number;
    cooldownMs: number;
    ipifyFailBeforeRecovery: number;
  };
  pendingTriggers: string[];
}

/** Operator hub origin (:3190). Env: SEATMESH_WEB_URL or SEATMESH_HUB_URL. */
export function resolveHubBaseUrl(): string {
  const env =
    process.env.SEATMESH_WEB_URL?.trim() ||
    process.env.SEATMESH_HUB_URL?.trim() ||
    "";
  if (env) return env.replace(/\/$/, "");
  return "http://127.0.0.1:3190";
}

/** @deprecated Prefer resolveHubBaseUrl (same value). */
export function defaultHubOrigin(): string {
  return resolveHubBaseUrl();
}

/**
 * Canonical Info/Decide card URL on the hub.
 * Daemon keeps POST /act/register, GET /act/card/:id?format=json, GET /act/v1/:token.
 */
export function hubActCardUrl(cardId: string, daemonPort: number): string {
  const id = encodeURIComponent(String(cardId).trim());
  const port = Number(daemonPort);
  const q = Number.isFinite(port) && port > 0 ? `?port=${port}` : "";
  return `${resolveHubBaseUrl()}/act/card/${id}${q}`;
}

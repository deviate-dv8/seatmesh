/** User-facing CLI strings — no workspace wrappers, no operator names. */

export const SEATMESH_BIN = "seatmesh";

/** zsign consumer profile from repo root — agents use this, not ./sm.sh */
export const SEATMESH_ZSIGN_PROFILE = "seatmesh --profile .sm";

/** Monorepo dev when global binary is stale: npx --prefix services/seat-mesh --no seatmesh -- --profile .sm … */
export const SEATMESH_ZSIGN_NPX =
  "npx --prefix services/seat-mesh --no seatmesh -- --profile .sm";

/** Install: `npm install -g seatmesh@latest` or monorepo npx prefix (see SEATMESH_ZSIGN_NPX) */
export const SEATMESH_INSTALL_HINT =
  "npm install -g seatmesh@latest  (dev: npx --prefix services/seat-mesh --no seatmesh -- …)";

export function seatmeshCmd(sub: string): string {
  const s = sub.trim();
  return s ? `${SEATMESH_ZSIGN_PROFILE} ${s}` : SEATMESH_ZSIGN_PROFILE;
}

export function seatmeshInboxRestart(): string {
  return seatmeshCmd("inbox restart");
}

export function seatmeshWithProfile(cmd: string): string {
  return `${cmd}  (pass --profile <dotdir> when not in the project tree)`;
}

export function seatmeshInboxDown(port: number): string {
  return `inbox down on :${port} — run: ${seatmeshInboxRestart()}`;
}

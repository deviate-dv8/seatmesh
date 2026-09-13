/** User-facing CLI strings — no workspace wrappers, no operator names. */

export const SEATMESH_BIN = "seatmesh";

/** Install: `npm install -g seatmesh@latest` or `npx seatmesh@latest -- …` */
export const SEATMESH_INSTALL_HINT =
  "npm install -g seatmesh@latest  (or npx seatmesh@latest -- …)";

export function seatmeshInboxRestart(): string {
  return `${SEATMESH_BIN} inbox restart`;
}

export function seatmeshWithProfile(cmd: string): string {
  return `${cmd}  (pass --profile <dotdir> when not in the project tree)`;
}

export function seatmeshInboxDown(port: number): string {
  return `inbox down on :${port} — run: ${seatmeshInboxRestart()}`;
}

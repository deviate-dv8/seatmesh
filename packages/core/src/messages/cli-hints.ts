/** User-facing CLI strings — no workspace wrappers with operator names. */

/** User-facing CLI name (installed bin: `sm`; npm also ships `seatmesh`). */
export const SEATMESH_BIN = "sm";

/**
 * Default agent/operator prefix. Profile walks up to `.sm/` — no flag needed.
 * Multi-config: `sm --profile .sm-<name> …` (see {@link seatmeshProfileCmd}).
 */
export const SEATMESH_DEFAULT = SEATMESH_BIN;

/**
 * @deprecated Alias of {@link SEATMESH_DEFAULT}. Kept so older imports compile.
 * Was `seatmesh --profile .sm` — that flag is optional now (default walk-up).
 */
export const SEATMESH_ZSIGN_PROFILE = SEATMESH_DEFAULT;

/** @deprecated Retired — agents must use {@link SEATMESH_DEFAULT} / {@link seatmeshCmd}. */
export const SEATMESH_AGENT_SHORTHAND = SEATMESH_DEFAULT;

/** Monorepo / foreign workspace when the published bin is stale. */
export const SEATMESH_ZSIGN_NPX = "npx --prefix services/seat-mesh --no seatmesh --";

/** Install: `npm install -g seatmesh@latest` or monorepo npx prefix (see SEATMESH_ZSIGN_NPX) */
export const SEATMESH_INSTALL_HINT =
  "npm install -g seatmesh@latest  (dev: npx --prefix services/seat-mesh --no seatmesh -- …)";

/** Normalize a multi-config id to a dotdir: `cpe` | `sm-cpe` | `.sm-cpe` → `.sm-cpe`. */
export function normalizeSmProfileDir(name: string): string {
  const t = name.trim();
  if (!t) throw new Error("profile name required");
  if (t === ".sm" || t === "sm") return ".sm";
  const bare = t.replace(/^\./, "").replace(/^sm-/, "");
  if (!bare || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(bare)) {
    throw new Error(`invalid profile name: ${name} (use sm-<id> / .sm-<id>)`);
  }
  return `.sm-${bare}`;
}

/** Explicit multi-config prefix: `sm --profile .sm-cpe`. */
export function seatmeshProfileCmd(profileDir: string, sub = ""): string {
  const dir = profileDir.startsWith(".") ? profileDir : normalizeSmProfileDir(profileDir);
  const base = `${SEATMESH_BIN} --profile ${dir}`;
  const s = sub.trim();
  return s ? `${base} ${s}` : base;
}

/**
 * Agent inject / card line — always through the gateway:
 * `sm agent <sub>`
 * Bare card: `sm agent`
 * Multi-config: {@link seatmeshProfileCmd}.
 */
export function seatmeshCmd(sub: string): string {
  const s = sub.trim();
  if (!s) return `${SEATMESH_DEFAULT} agent`;
  if (s === "agent" || s.startsWith("agent ")) {
    return `${SEATMESH_DEFAULT} ${s}`;
  }
  return `${SEATMESH_DEFAULT} agent ${s}`;
}

/** Top-level (operator / shared) — no `agent` gateway. */
export function seatmeshCmdTop(sub: string): string {
  const s = sub.trim();
  return s ? `${SEATMESH_DEFAULT} ${s}` : SEATMESH_DEFAULT;
}

/** @deprecated Same as {@link seatmeshCmdTop}. */
export function seatmeshCmdLong(sub: string): string {
  return seatmeshCmdTop(sub);
}

export function seatmeshInboxRestart(): string {
  return seatmeshCmdTop("inbox restart");
}

export function seatmeshWithProfile(cmd: string): string {
  return `${cmd}  (multi-config: sm --profile .sm-<name> …)`;
}

export function seatmeshInboxDown(port: number): string {
  return `inbox down on :${port} — run: ${seatmeshInboxRestart()}`;
}

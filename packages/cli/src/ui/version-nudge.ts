import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NPM_REGISTRY = "https://registry.npmjs.org";

/** Public npm release track (shown in upgrade hint). */
export const SEATMESH_RELEASE_NOTE = "Latest: seatmesh@1.0.2 (2026-09-14).";

export function readInstalledCliVersion(): string {
  // version-nudge.ts lives in src/ui/ (dist/ui/); package.json is at the package root.
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
  return raw.version?.trim() || "0.0.0";
}

/** True for global / npx installs — skip git monorepo `packages/cli/dist` dev path. */
export function isRegistrySeatmeshInstall(): boolean {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return dir.includes(`${path.sep}node_modules${path.sep}seatmesh${path.sep}`);
}

/**
 * True when running from npx's throwaway per-invocation cache (`~/.npm/_npx/<hash>/...`)
 * rather than a real `npm install -g seatmesh` — re-resolved/redownloaded every run, no
 * stable version pin, and easy to confuse with "seatmesh isn't really installed."
 */
export function isNpxEphemeralInstall(): boolean {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return dir.includes(`${path.sep}_npx${path.sep}`);
}

export function formatInstallStatusLine(installed: string, latest: string | null): string {
  const upToDate = !latest || !semverLess(installed, latest);
  const versionPart = `seatmesh ${installed}${latest ? (upToDate ? " (up to date)" : ` (latest: ${latest})`) : ""}`;
  if (!isRegistrySeatmeshInstall()) return `${versionPart} [dev checkout]`;
  if (isNpxEphemeralInstall()) {
    return `${versionPart} -- WARN: running via npx cache, not installed. Run: npm install -g seatmesh@latest`;
  }
  return versionPart;
}

export function semverLess(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

function versionCachePath(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "seatmesh", "registry-version.json");
}

interface VersionCache {
  latest: string;
  checkedAt: number;
}

function readVersionCache(): VersionCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(versionCachePath(), "utf8")) as VersionCache;
    if (!raw.latest || !raw.checkedAt) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeVersionCache(latest: string): void {
  const file = versionCachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ latest, checkedAt: Date.now() } satisfies VersionCache),
    "utf8",
  );
}

function fetchLatestFromRegistry(): string | null {
  const r = spawnSync(
    "npm",
    ["view", "seatmesh", "version", "--registry", NPM_REGISTRY],
    { encoding: "utf8", timeout: 5000 },
  );
  if (r.status !== 0) return null;
  const v = (r.stdout ?? "").trim();
  return v || null;
}

export function resolveLatestRegistryVersion(force = false): string | null {
  if (!force) {
    const cached = readVersionCache();
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      return cached.latest;
    }
  }
  const latest = fetchLatestFromRegistry();
  if (latest) writeVersionCache(latest);
  return latest;
}

export function formatVersionUpgradeHint(installed: string, latest: string): string {
  return (
    `seatmesh: installed ${installed}; npm latest ${latest}. ${SEATMESH_RELEASE_NOTE} ` +
    `Upgrade: npm install -g seatmesh@latest  or  npx seatmesh@latest <cmd…>`
  );
}

/** stderr hint when registry has a newer seatmesh (registry/npx/global installs only). */
export function maybePrintVersionNudge(opts?: { forceCheck?: boolean }): void {
  if (process.env.SEATMESH_SKIP_VERSION_CHECK === "1") return;
  if (!isRegistrySeatmeshInstall()) return;

  const installed = readInstalledCliVersion();
  const latest = resolveLatestRegistryVersion(Boolean(opts?.forceCheck));
  if (!latest || !semverLess(installed, latest)) return;

  console.error(formatVersionUpgradeHint(installed, latest));
}

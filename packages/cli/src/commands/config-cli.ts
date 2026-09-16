import type { ConfigCheckResult } from "@seat-mesh/core";
import { checkMeshConfig } from "@seat-mesh/core";
import {
  formatInstallStatusLine,
  readInstalledCliVersion,
  resolveLatestRegistryVersion,
  semverLess,
} from "../ui/version-nudge.js";

export function printConfigCheck(result: ConfigCheckResult): void {
  const errors = result.issues.filter((i) => i.severity === "error");
  const warns = result.issues.filter((i) => i.severity === "warn");
  const head = result.ok ? "OK" : "FAIL";
  console.log(
    `config check: ${head} (${errors.length} error${errors.length === 1 ? "" : "s"}, ${warns.length} warn${warns.length === 1 ? "" : "s"})`,
  );
  console.log(`  profile: ${result.profilePath}`);
  if (result.workspace) console.log(`  workspace: ${result.workspace}`);
  if (result.daemonPort != null) console.log(`  daemon port: ${result.daemonPort}`);
  if (result.remoteAliases.length) {
    console.log(`  remotes: ${result.remoteAliases.join(", ")}`);
  }
  for (const i of result.issues) {
    const tag = i.severity === "error" ? "error" : "warn";
    const field = i.field ? ` (${i.field})` : "";
    console.log(`  [${tag}]${field} ${i.message}`);
  }
  if (result.ok && !result.issues.length) {
    console.log("  schema + paths OK — safe to reload/inbox restart after edits");
  } else if (result.ok) {
    console.log("  schema OK — warnings only (review before reload)");
  } else {
    console.log("  fix errors before inbox restart or session up");
  }
}

export function runConfigCheck(profileArg: string | undefined, opts?: { json?: boolean }): number {
  const result = checkMeshConfig(profileArg);
  if (opts?.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printConfigCheck(result);
  }
  return result.ok ? 0 : 1;
}

/** How to get the latest published seatmesh CLI (step 1 before profile `update`). */
export function printConfigUpgradeGuide(): void {
  const installed = readInstalledCliVersion();
  const npmLatest = resolveLatestRegistryVersion(true);
  console.log(formatInstallStatusLine(installed, npmLatest));
  console.log("");
  console.log("config upgrade — get the latest seatmesh CLI first");
  console.log("");
  console.log("  1) Upgrade the package (pick one):");
  console.log("       npm install -g seatmesh@latest");
  console.log("       npx seatmesh@latest --version     # one-shot without global");
  console.log("  2) Refresh this mesh profile from that CLI:");
  console.log("       seatmesh update");
  console.log("       # or: npx seatmesh@latest update");
  console.log("");
  console.log("  update alone does NOT bump npm — it only syncs .sm/_vendor from the CLI you ran.");
  if (npmLatest && semverLess(installed, npmLatest)) {
    console.log("");
    console.log(`  You are behind: CLI ${installed} < npm ${npmLatest} — run step 1 now.`);
  }
}

export function printConfigHelp(): void {
  console.log(`config — mesh config / CLI upgrade

  config check [--json]     validate mesh.config.yaml + paths
  config upgrade            how to get latest seatmesh (npm i -g seatmesh@latest)

Upgrade path (always step 1 → step 2):
  1) npm install -g seatmesh@latest
  2) seatmesh update          # refresh .sm/_vendor from that CLI

  update without step 1 only refreshes vendor from whatever CLI is already running.`);
}

import { spawnSync } from "node:child_process";
import path from "node:path";
import { findDotSmConfig } from "@seat-mesh/core";
import { printSeatmeshBanner, SEATMESH_TAGLINE } from "./banner.js";
import { terminalBold } from "./logo-color.js";

export { SEATMESH_TAGLINE };

function which(bin: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0;
}

export interface DiscoveryReportOptions {
  cwd?: string;
  json?: boolean;
}

export interface DiscoveryReport {
  ok: boolean;
  cwd: string;
  hasProject: boolean;
  projectConfig: string | null;
}

const COMMANDS = ["init", "sessions", "session up", "session attach", "help"];

/** Greenfield / no `.sm/` — no profile load. */
export async function printDiscoveryReport(
  opts: DiscoveryReportOptions = {},
): Promise<DiscoveryReport> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const projectConfig = findDotSmConfig(cwd);
  const hasProject = projectConfig != null;
  const tmuxOk = which("tmux");
  const curlOk = which("curl");

  const report: DiscoveryReport = {
    ok: hasProject || (tmuxOk && curlOk),
    cwd,
    hasProject,
    projectConfig,
  };

  if (opts.json) {
    console.log(
      JSON.stringify(
        { ...report, tagline: SEATMESH_TAGLINE, commands: COMMANDS },
        null,
        2,
      ),
    );
    return report;
  }

  printSeatmeshBanner({ tagline: true });
  if (hasProject) {
    console.log(terminalBold("npx seatmesh"));
  } else {
    console.log("seatmesh is not initialized on this project");
    console.log(terminalBold("npx seatmesh init"));
  }
  console.log("");
  for (const cmd of COMMANDS) console.log(`  ${cmd}`);

  return report;
}

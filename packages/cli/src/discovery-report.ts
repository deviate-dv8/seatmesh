import { spawnSync } from "node:child_process";
import path from "node:path";
import { findDotSmConfig, SM_DIR } from "@seat-mesh/core";

function which(bin: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0;
}

function tmuxVersion(): string | null {
  const r = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
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

const COMMANDS: Array<{ cmd: string; note: string }> = [
  { cmd: "init", note: "create .sm/ project config in this folder" },
  { cmd: "session up", note: "start tmux workbench (after init)" },
  { cmd: "session attach", note: "attach to running session" },
  { cmd: "whoami", note: "pane identity (inside tmux)" },
  { cmd: "verify", note: "layout + labels health" },
  { cmd: "inbox", note: "inbox daemon status" },
  { cmd: "contexts", note: "seat FOCUS summary" },
  { cmd: "help", note: "full command list" },
];

/** Greenfield / no `.sm/` — no profile load, no bundled minimal fallback. */
export async function printDiscoveryReport(
  opts: DiscoveryReportOptions = {},
): Promise<DiscoveryReport> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const projectConfig = findDotSmConfig(cwd);
  const hasProject = projectConfig != null;

  const tmuxOk = which("tmux");
  const curlOk = which("curl");
  const npmOk = which("npm");

  const report: DiscoveryReport = {
    ok: hasProject || (tmuxOk && curlOk),
    cwd,
    hasProject,
    projectConfig,
  };

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          prereqs: { node: process.version, tmux: tmuxOk, curl: curlOk, npm: npmOk },
          commands: COMMANDS,
        },
        null,
        2,
      ),
    );
    return report;
  }

  console.log("seatmesh — workspace check\n");

  console.log("## This folder");
  console.log(`cwd=${cwd}`);
  if (hasProject) {
    console.log(`project=FOUND  ${projectConfig}`);
    console.log("next:  npx seatmesh        (full stack status)");
    console.log("       npx seatmesh session attach");
  } else {
    console.log(`project=MISSING  (no ${SM_DIR}/mesh.config.yaml here or above)`);
    console.log("next:  npx seatmesh init   (create a project in this folder)");
  }

  console.log("\n## Prerequisites");
  console.log(`PASS  node: ${process.version}`);
  console.log(`${npmOk ? "PASS" : "WARN"}  npm: ${npmOk ? "ok" : "missing (needed for init cold-start)"}`);
  console.log(
    `${tmuxOk ? "PASS" : "FAIL"}  tmux: ${tmuxOk ? (tmuxVersion() ?? "ok") : "not in PATH (required for sessions)"}`,
  );
  console.log(`${curlOk ? "PASS" : "FAIL"}  curl: ${curlOk ? "ok" : "missing (inbox health checks)"}`);
  console.log(`${which("git") ? "PASS" : "WARN"}  git: ${which("git") ? "ok" : "optional"}`);

  for (const [label, bin] of [
    ["cursor-agent", "agent"],
    ["claude", "claude"],
    ["kiro", "kiro"],
    ["opencode", "opencode"],
  ] as const) {
    const ok = which(bin);
    console.log(`${ok ? "PASS" : "WARN"}  cli:${label}: ${ok ? "in PATH" : "not found"}`);
  }

  console.log("\n## Commands (after init)");
  for (const { cmd, note } of COMMANDS) {
    console.log(`  ${cmd.padEnd(16)} ${note}`);
  }

  console.log("\n## Note");
  console.log(
    "seatmesh is a tmux multi-agent workbench (terminal UI), not a fullscreen TUI.",
  );
  console.log("Bare `npx seatmesh` = this checklist; `npx seatmesh init` starts a project.");

  if (!hasProject) {
    console.log("\nHint: run  npx seatmesh init  in this folder, then  npx seatmesh session up");
  }

  return report;
}

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LoadedProfile } from "@seat-mesh/core";
import { tmux } from "../lib/tmux-run.js";

/**
 * Absolute path to the seatmesh CLI entry (dist/main.js) when invoked as the CLI.
 * Falls back to PATH `seatmesh` for hooks spawned from the daemon.
 */
export function resolveSeatmeshCliEntry(): string {
  const argv1 = process.argv[1]?.trim();
  if (argv1) {
    try {
      const abs = path.resolve(argv1);
      if (fs.existsSync(abs) && /(?:^|[\\/])(?:seatmesh|main)\.(?:js|mjs|cjs)$/i.test(abs)) {
        return abs;
      }
      if (fs.existsSync(abs) && abs.includes(`${path.sep}seatmesh${path.sep}`)) {
        return abs;
      }
    } catch {
      /* fall through */
    }
  }
  // Dev monorepo: packages/tmux → packages/cli/dist/main.js
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cliMain = path.resolve(here, "../../../cli/dist/main.js");
    if (fs.existsSync(cliMain)) return cliMain;
  } catch {
    /* fall through */
  }
  return "seatmesh";
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Prefer a PATH `node` for hooks — process.execPath may be a private Cursor binary. */
function hookNodeBinary(): string {
  const exec = process.execPath;
  if (/cursor-agent|Cursor\.app|\.cursor-server/i.test(exec)) {
    return "node";
  }
  return exec;
}

/** Persist mesh-agents.json when the operator detaches or the session is killed. */
export function installSessionSaveHooks(
  session: string,
  loaded: LoadedProfile,
): void {
  const profile = loaded.profilePath;
  const cli = resolveSeatmeshCliEntry();
  const wd = loaded.workspace;
  const node = hookNodeBinary();
  const cmd =
    cli === "seatmesh"
      ? `cd ${shellQuote(wd)} && seatmesh --profile ${shellQuote(profile)} save >/dev/null 2>&1 || true`
      : `cd ${shellQuote(wd)} && ${shellQuote(node)} ${shellQuote(cli)} --profile ${shellQuote(profile)} save >/dev/null 2>&1 || true`;

  // Replace prior mesh save hooks (index 91) so re-attach does not stack duplicates.
  tmux(["set-hook", "-t", session, "-u", "client-detached[91]"]);
  tmux(["set-hook", "-t", session, "-u", "session-closed[91]"]);
  tmux(["set-hook", "-t", session, "client-detached[91]", `run-shell ${shellQuote(cmd)}`]);
  tmux(["set-hook", "-t", session, "session-closed[91]", `run-shell ${shellQuote(cmd)}`]);
}

/**
 * After attach returns to the foreground, inbox/coord still need care — do it in a
 * detached child so `tmux attach` is not blocked.
 */
export function spawnDetachedSessionSync(loaded: LoadedProfile): void {
  const cli = resolveSeatmeshCliEntry();
  const env = { ...process.env, SEATMESH_SKIP_VERSION_CHECK: "1" };
  try {
    if (cli === "seatmesh") {
      const child = spawn("seatmesh", ["--profile", loaded.profilePath, "session", "sync"], {
        detached: true,
        stdio: "ignore",
        cwd: loaded.workspace,
        env,
      });
      child.unref();
      return;
    }
    const child = spawn(
      process.execPath,
      [cli, "--profile", loaded.profilePath, "session", "sync"],
      {
        detached: true,
        stdio: "ignore",
        cwd: loaded.workspace,
        env,
      },
    );
    child.unref();
  } catch {
    /* non-fatal — attach still proceeds */
  }
}

/**
 * Scrub tmux server globals that wash out TUIs (NO_COLOR, TERM=dumb).
 * Stamp mesh session identity for multi-root workspaces.
 */
export function ensureMeshSessionEnv(
  session: string,
  opts: {
    workspaceId?: string;
    sessionName?: string;
    workspace?: string;
    profilePath?: string;
  } = {},
): void {
  tmux(["set-environment", "-gu", "NO_COLOR"]);
  tmux(["set-environment", "-gu", "FORCE_COLOR"]);
  const gterm = tmux(["show-environment", "-g", "TERM"]).out;
  if (gterm === "TERM=dumb" || gterm === "TERM=") {
    tmux(["set-environment", "-gu", "TERM"]);
  }
  tmux(["set-environment", "-g", "COLORTERM", "truecolor"]);

  if (opts.workspaceId) {
    tmux(["set-environment", "-t", session, "MESH_WORKSPACE_ID", opts.workspaceId]);
  }
  if (opts.sessionName) {
    tmux(["set-environment", "-t", session, "MESH_SESSION", opts.sessionName]);
  }
  if (opts.workspace) {
    tmux(["set-environment", "-t", session, "MESH_WORKSPACE", opts.workspace]);
  }
  if (opts.profilePath) {
    tmux(["set-environment", "-t", session, "MESH_PROFILE_PATH", opts.profilePath]);
  }
}

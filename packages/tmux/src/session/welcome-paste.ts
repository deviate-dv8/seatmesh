import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core";
import { prepareOpenCodeForPaste } from "../agents/oc-stop.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { withPaneInputEnabled } from "../inject/inject.js";
import { tmux } from "../lib/tmux-run.js";

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function welcomeScriptPath(loaded: LoadedProfile, paneId: string, tag: string): string {
  const safePane = paneId.replace(/[^a-zA-Z0-9]/g, "_");
  const dir = path.join(loaded.profileDir, "runtime", "welcome");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${tag}-${safePane}.sh`);
}

/**
 * Run a short bash script in a pane — avoids huge `send-keys -l` base64 pastes that
 * zsh/tmux truncate (garbled echo + half-decoded blobs on manager/logs panes).
 */
export function pasteWelcomeScript(
  loaded: LoadedProfile,
  paneId: string,
  script: string,
  opts: { tag: string; welcomeOpt?: string; status?: string },
): void {
  if (opts.welcomeOpt) {
    const done = tmux(["display-message", "-t", paneId, "-p", `#{@${opts.welcomeOpt}}`]).out.trim();
    if (done === "1") return;
  }

  const file = welcomeScriptPath(loaded, paneId, opts.tag);
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${script}\n`, {
    encoding: "utf8",
    mode: 0o755,
  });

  const ocCpe = /opencode-cpe\.sh/i.test(script);
  withPaneInputEnabled(paneId, () => {
    if (ocCpe) {
      prepareOpenCodeForPaste(paneId, capturePaneSnapshot);
    } else {
      tmux(["send-keys", "-t", paneId, "C-c"]);
      sleepMs(80);
    }
    tmux(["send-keys", "-t", paneId, "clear", "Enter"]);
    sleepMs(120);
    tmux(["send-keys", "-t", paneId, "-l", `bash ${shellQuote(file)}`]);
    sleepMs(40);
    tmux(["send-keys", "-t", paneId, "Enter"]);
  });

  if (opts.welcomeOpt) {
    tmux(["set-option", "-p", "-t", paneId, `@${opts.welcomeOpt}`, "1"]);
  }
  if (opts.status) {
    tmux(["set-option", "-p", "-t", paneId, "@mesh_status", opts.status]);
  }
}

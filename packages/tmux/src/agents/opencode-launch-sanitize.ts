import {
  cmdlines,
  extractOpenCodeSession,
  matchAny,
  normalizeOpenCodeSessionId,
} from "@seat-mesh/providers";
import fs from "node:fs";
import path from "node:path";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmux } from "../lib/tmux-run.js";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import {
  injectOpenCodeSessionIntoCmd,
  isOpenCodeCpeResumeCmd,
} from "../session/save-session.js";
import { isOpenCodeLaunch } from "./launch-verify.js";

/** Best-effort: ses_* dir under common OpenCode storage roots. */
function openCodeSessionExists(workspace: string, sid: string): boolean {
  const roots = [
    path.join(workspace, ".opencode", "sessions"),
    path.join(workspace, ".opencode", "data", "sessions"),
    path.join(process.env.HOME || "", ".local", "share", "opencode", "sessions"),
  ];
  for (const root of roots) {
    if (fs.existsSync(path.join(root, sid))) return true;
  }
  return true; // unknown layout — keep resume rather than force fresh
}

export function freshOpenCodeCmd(workspace: string, cmd: string): string {
  if (isOpenCodeCpeResumeCmd(cmd)) {
    return injectOpenCodeSessionIntoCmd(cmd, null);
  }
  return buildAgentLaunchCmd("opencode", workspace, null) ?? cmd;
}

/** Another live OC pane in this tmux session already holds this session id. */
export function openCodeSessionInUseByOtherPane(
  tmuxSession: string,
  paneId: string,
  sessionId: string,
): boolean {
  const out = tmux([
    "list-panes",
    "-s",
    "-t",
    tmuxSession,
    "-F",
    "#{pane_id}\t#{@mesh_oc_session}",
  ]).out;
  for (const line of out.split("\n")) {
    const [pid, sidRaw] = line.split("\t");
    if (!pid?.startsWith("%") || pid === paneId) continue;
    const sid = normalizeOpenCodeSessionId(sidRaw);
    if (sid !== sessionId) continue;
    const snap = capturePaneSnapshot(pid);
    if (snap && matchAny(cmdlines(snap), [/opencode/])) return true;
  }
  return false;
}

/**
 * Drop dead / shared `--session` ids before paste — each OC pane needs its own
 * live session or a fresh `--auto` boot.
 */
export function sanitizeOpenCodeLaunchCmd(
  workspace: string,
  tmuxSession: string,
  paneId: string,
  cmd: string | null,
  harnessType: string,
): string | null {
  if (!cmd || !isOpenCodeLaunch(harnessType, cmd)) return cmd;

  const sid = normalizeOpenCodeSessionId(extractOpenCodeSession(cmd));
  if (!sid) return cmd;

  if (!openCodeSessionExists(workspace, sid)) {
    return freshOpenCodeCmd(workspace, cmd);
  }
  if (openCodeSessionInUseByOtherPane(tmuxSession, paneId, sid)) {
    return freshOpenCodeCmd(workspace, cmd);
  }
  return cmd;
}

export function paneShowsOpenCodeSessionMiss(paneId: string): boolean {
  const tail = capturePaneSnapshot(paneId)?.captureTail ?? "";
  return /Session not found:/i.test(tail);
}

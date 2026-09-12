import { spawnSync } from "node:child_process";
import {
  extractOpenCodeSession,
  listOpenCodeSessions,
  normalizeOpenCodeSessionId,
  scrapeOpenCodeSessionFromCapture,
} from "@seat-mesh/providers";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmux } from "../lib/tmux-run.js";

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)]);
}

/** Scrape live pane for ses_* and stamp @mesh_oc_session (clears bad UUIDs). */
export function syncOpenCodePaneSession(
  paneId: string,
  opts: { waitMs?: number; retries?: number } = {},
): string | null {
  const waitMs = opts.waitMs ?? 2500;
  const retries = opts.retries ?? 2;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) sleepMs(waitMs);
    const snap = capturePaneSnapshot(paneId);
    if (!snap) continue;

    for (const cmd of (snap.options.processCmdlines ?? "").split("\0").filter(Boolean)) {
      const sid = normalizeOpenCodeSessionId(extractOpenCodeSession(cmd));
      if (sid) {
        tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", sid]);
        return sid;
      }
    }

    const fromCapture = normalizeOpenCodeSessionId(
      scrapeOpenCodeSessionFromCapture(snap.captureTail),
    );
    if (fromCapture) {
      tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", fromCapture]);
      return fromCapture;
    }
  }

  const snap = capturePaneSnapshot(paneId);
  const workspace = snap?.cwd?.trim();
  if (workspace) {
    const sessions = listOpenCodeSessions(workspace, 15);
    if (sessions.length) {
      sessions.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
      const sid = normalizeOpenCodeSessionId(sessions[0]?.id);
      if (sid) {
        tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", sid]);
        return sid;
      }
    }
  }

  tmux(["set-option", "-p", "-t", paneId, "@mesh_oc_session", ""]);
  return null;
}

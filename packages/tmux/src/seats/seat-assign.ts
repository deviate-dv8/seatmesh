import { assignPrompt, type LoadedProfile } from "@seat-mesh/core";
import { enqueuePrompt } from "../inject/prompt.js";
import { parseSeatTarget } from "./seat-paths.js";
import { appendTask, setFocusNow } from "./seat-update.js";

export interface AssignResult {
  target: string;
  paneId: string;
  targetLabel: string;
  token?: string;
  via?: string;
}

/** FOCUS NOW + TASK + peer SENT. Next agent must not hand-edit FOCUS. */
export function runAssign(
  loaded: LoadedProfile,
  targetRaw: string,
  text: string,
): AssignResult {
  const now = text.trim();
  if (!targetRaw || !now) {
    throw new Error("usage: assign <target> <text...>");
  }
  const target = parseSeatTarget(targetRaw);
  setFocusNow(loaded, target, now);
  appendTask(loaded, target, now);
  const sent = enqueuePrompt(loaded, targetRaw, assignPrompt(targetRaw, now), {
    manager: true,
  });
  return {
    target: targetRaw,
    paneId: sent.paneId,
    targetLabel: sent.targetLabel,
    token: sent.token,
    via: sent.via,
  };
}

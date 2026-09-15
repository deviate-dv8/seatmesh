import { assignPrompt, resolveTodosConfig, type LoadedProfile } from "@seat-mesh/core";
import {
  armCoordExpectAfterAssign,
  isHumanCoTypedTarget,
  postAssignRoomNotice,
} from "../coord/coord-expect.js";
import { enqueuePrompt } from "../inject/prompt.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { parseSeatTarget } from "./seat-paths.js";
import { appendTask, setFocusNow } from "./seat-update.js";
import { addSeatTodo } from "./seat-todo.js";

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

  const resolved = resolvePaneTarget(targetRaw, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  const coTyped = isHumanCoTypedTarget(loaded, targetRaw);
  let paneId = resolved.paneId;
  let targetLabel = targetRaw;
  let token: string | undefined;
  let via: string | undefined;

  if (coTyped) {
    postAssignRoomNotice(loaded, targetRaw, now);
    via = "room+focus";
  } else {
    const sent = enqueuePrompt(loaded, targetRaw, assignPrompt(targetRaw, now), {
      manager: true,
    });
    paneId = sent.paneId;
    targetLabel = sent.targetLabel;
    token = sent.token;
    via = sent.via;
  }

  const todosCfg = resolveTodosConfig(loaded);
  armCoordExpectAfterAssign(loaded, {
    target: targetRaw,
    assignText: now,
    duration: todosCfg.checkbackDuration,
    renew: todosCfg.checkbackRenew,
  });

  // Assignee todo CB (≥20m). appendTask already ran — addSeatTodo is idempotent on the line.
  try {
    addSeatTodo(loaded, target, now, targetRaw);
  } catch {
    /* CB arm best-effort */
  }

  return {
    target: targetRaw,
    paneId,
    targetLabel,
    token,
    via,
  };
}

import {
  armCheckbackSync,
  cancelCheckbackSync,
  chatRoomConfigForLoaded,
  formatTodoExpect,
  resolveTodosConfig,
  todoCheckbackId,
  type LoadedProfile,
} from "@seat-mesh/core";
import { enqueuePrompt } from "../inject/prompt.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import type { SeatTarget } from "./seat-paths.js";
import { appendTask, checkTask } from "./seat-update.js";

export interface TodoAddResult {
  seatLabel: string;
  text: string;
  reportTo: string;
  cbDuration: string;
  cbId: string | null;
  cbArmed: boolean;
  cbReason?: string;
}

export interface TodoCheckResult {
  seatLabel: string;
  match: string;
  reportTo: string;
  reported: boolean;
  reportVia?: string;
  cbCancelled: boolean;
}

export function seatLabelForTarget(target: SeatTarget, fallback = "here"): string {
  if (target.role === "worker" && target.slot) return `slot-${target.slot}`;
  if (target.role === "manager-mini" && target.mini) return `mini-${target.mini}`;
  return target.role || fallback;
}

/** Add open todo + arm ≥20m checkback on that seat's pane. */
export function addSeatTodo(
  loaded: LoadedProfile,
  target: SeatTarget,
  text: string,
  targetRaw = "here",
): TodoAddResult {
  const body = text.trim();
  if (!body) throw new Error("todo text empty");
  appendTask(loaded, target, body);

  const cfg = resolveTodosConfig(loaded);
  const seatLabel = seatLabelForTarget(target, targetRaw);
  const expect = formatTodoExpect(seatLabel, body);
  const cbId = todoCheckbackId(seatLabel, body);

  const pane = resolvePaneTarget(targetRaw, loaded);
  if ("error" in pane) {
    return {
      seatLabel,
      text: body,
      reportTo: cfg.reportTo,
      cbDuration: cfg.checkbackDuration,
      cbId: null,
      cbArmed: false,
      cbReason: pane.error,
    };
  }

  const room = chatRoomConfigForLoaded(loaded);
  const armed = armCheckbackSync({
    inboxBase: room.inboxBase,
    ownerPane: pane.paneId,
    expect,
    duration: cfg.checkbackDuration,
    renew: cfg.checkbackRenew,
    kind: "todo",
    id: cbId,
    senderPane: pane.paneId,
    ownerSlot: pane.row.slot ?? null,
    ownerMini: pane.row.mini ?? null,
  });

  return {
    seatLabel,
    text: body,
    reportTo: cfg.reportTo,
    cbDuration: cfg.checkbackDuration,
    cbId,
    cbArmed: armed.ok,
    cbReason: armed.ok ? undefined : armed.reason,
  };
}

/** Mark todo done + peer DONE: to configured reportTo + cancel todo CB. */
export function checkSeatTodo(
  loaded: LoadedProfile,
  target: SeatTarget,
  matchText: string,
  targetRaw = "here",
): TodoCheckResult | null {
  const match = matchText.trim();
  if (!match) throw new Error("todo match empty");
  const openText = checkTask(loaded, target, match);
  if (!openText) return null;

  const cfg = resolveTodosConfig(loaded);
  const seatLabel = seatLabelForTarget(target, targetRaw);
  const cbId = todoCheckbackId(seatLabel, openText);

  let cbCancelled = false;
  try {
    const room = chatRoomConfigForLoaded(loaded);
    cbCancelled = cancelCheckbackSync(room.inboxBase, cbId).ok;
  } catch {
    cbCancelled = false;
  }

  let reported = false;
  let reportVia: string | undefined;
  try {
    const msg = `DONE: ${seatLabel} checked todo — ${openText}`;
    const sent = enqueuePrompt(loaded, cfg.reportTo, msg, {
      manager: false,
      prefix: "",
      armCheckback: false,
    });
    reported = true;
    reportVia = sent.via ?? "queued";
  } catch (e) {
    reportVia = e instanceof Error ? e.message : String(e);
  }

  return {
    seatLabel,
    match: openText,
    reportTo: cfg.reportTo,
    reported,
    reportVia,
    cbCancelled,
  };
}

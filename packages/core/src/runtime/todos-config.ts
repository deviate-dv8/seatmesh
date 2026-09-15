import type { LoadedProfile } from "../profile/profile.js";
import { parseDurationToSeconds } from "../chatroom/duration.js";

/** Default floor when profile omits todos.checkback.min. */
export const TODO_CB_MIN_DURATION = "20m";
export const TODO_CB_MIN_SEC = 20 * 60;

export interface TodosConfig {
  reportTo: string;
  checkbackDuration: string;
  checkbackRenew: string;
  checkbackMin: string;
}

/** Ensure duration string is ≥ minSec; otherwise return floorLabel. */
export function floorDuration(
  duration: string,
  minSec: number,
  floorLabel: string,
): string {
  const sec = parseDurationToSeconds(duration);
  if (sec == null || sec < minSec) return floorLabel;
  return duration.trim();
}

export function resolveTodosConfig(loaded: LoadedProfile): TodosConfig {
  const t = loaded.profile.todos;
  const minRaw = t?.checkback?.min ?? TODO_CB_MIN_DURATION;
  const minSec = parseDurationToSeconds(minRaw) ?? TODO_CB_MIN_SEC;
  const minLabel = minSec >= TODO_CB_MIN_SEC ? minRaw.trim() : TODO_CB_MIN_DURATION;
  const floorSec = parseDurationToSeconds(minLabel) ?? TODO_CB_MIN_SEC;
  const duration = floorDuration(
    t?.checkback?.duration ?? minLabel,
    floorSec,
    minLabel,
  );
  const renewRaw = t?.checkback?.renew ?? "10m";
  const renewSec = parseDurationToSeconds(renewRaw);
  const renew = renewSec != null && renewSec >= 60 ? renewRaw.trim() : "10m";
  return {
    reportTo: (t?.reportTo ?? "manager").trim() || "manager",
    checkbackDuration: duration,
    checkbackRenew: renew,
    checkbackMin: minLabel,
  };
}

export function formatTodoExpect(seatLabel: string, taskText: string): string {
  const snip = taskText.replace(/\s+/g, " ").trim().slice(0, 120);
  return `todo:${seatLabel} ${snip}`;
}

export function todoCheckbackId(seatLabel: string, taskText: string): string {
  const snip = taskText
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
  return `cb-todo-${seatLabel}-${snip || "task"}`.slice(0, 96);
}

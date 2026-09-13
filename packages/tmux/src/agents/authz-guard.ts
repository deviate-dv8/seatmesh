import { isCoordKind, type LoadedProfile } from "@seat-mesh/core";
import { runWhoami } from "./whoami.js";

/**
 * Central UNAUTHORIZED guard (FRAMEWORK-QUEUE #1). Deny-by-default for the listed
 * command against the pane's own role. Prints the spec's exact format and exits 2 —
 * callers do not catch this, it terminates the process.
 */
export function requireRole(loaded: LoadedProfile, allowed: string[], cmdLabel: string): void {
  const w = runWhoami(loaded, "here");
  if (allowed.includes(w.role)) return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=${allowed.join("|")} (you_are=${w.role})`,
  );
  console.error("hint: seatmesh --profile .sm agent");
  process.exit(2);
}

/** Coordinator tier — any manager-kind or secretary-kind column id. */
export function requireCoordRole(loaded: LoadedProfile, cmdLabel: string): void {
  const w = runWhoami(loaded, "here");
  if (isCoordKind(w.role, loaded.profile?.layout?.base.kinds)) return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=manager|secretary (you_are=${w.role})`,
  );
  console.error("hint: seatmesh --profile .sm agent");
  process.exit(2);
}

/**
 * Inbox lifecycle (start/stop/restart) — manager-1 + secretary only.
 * manager-2/3 bouncing inbox on first blip wedges the shared daemon for everyone.
 * Outside tmux (operator shell) is always allowed.
 */
export function requireInboxLifecycleRole(loaded: LoadedProfile, cmdLabel: string): void {
  if (!process.env.TMUX_PANE) return;
  const w = runWhoami(loaded, "here");
  if (w.role === "manager" || w.role === "secretary") return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=manager|secretary (you_are=${w.role})`,
  );
  console.error(
    "hint: ask manager or secretary to run inbox restart — do not bounce from manager-2/3",
  );
  process.exit(2);
}

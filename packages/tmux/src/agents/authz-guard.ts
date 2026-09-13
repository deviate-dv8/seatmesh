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
  console.error("hint: ./sm.sh agent");
  process.exit(2);
}

/** Coordinator tier — any manager-kind or secretary-kind column id. */
export function requireCoordRole(loaded: LoadedProfile, cmdLabel: string): void {
  const w = runWhoami(loaded, "here");
  if (isCoordKind(w.role, loaded.profile?.layout?.base.kinds)) return;
  console.error(
    `UNAUTHORIZED: ${cmdLabel} requires role=manager|secretary (you_are=${w.role})`,
  );
  console.error("hint: ./sm.sh agent");
  process.exit(2);
}

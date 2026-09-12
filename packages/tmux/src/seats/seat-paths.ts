import path from "node:path";
import { buildResolvedPaths, meshRuntimePaths, type LoadedProfile } from "@seat-mesh/core";

export interface SeatTarget {
  role: string;
  slot?: string | null;
  mini?: string | null;
}

/** Resolve tasks/agent-seats/<dir> for worker, mini, manager, secretary. */
export function seatDirFor(loaded: LoadedProfile, target: SeatTarget): string | null {
  const root = buildResolvedPaths(loaded).seatsRoot;
  const dirs = loaded.profile.seats.dirs;

  if (target.role === "manager") {
    return path.join(root, dirs?.manager ?? "manager");
  }
  if (target.role === "manager-2") {
    return path.join(root, dirs?.["manager-2"] ?? "manager-2");
  }
  if (target.role === "secretary") {
    return path.join(root, dirs?.secretary ?? "secretary");
  }
  if (target.mini) {
    const pat = dirs?.mini ?? "mini-{n}";
    if (pat.endsWith(".json")) return null;
    return path.join(root, pat.replace("{n}", String(target.mini)));
  }
  if (target.slot && /^\d+$/.test(target.slot)) {
    const pat = dirs?.worker ?? "slot-{n}";
    return path.join(root, pat.replace("{n}", target.slot));
  }
  return null;
}

export function seatFile(
  loaded: LoadedProfile,
  target: SeatTarget,
  name: "FOCUS.md" | "TASKS.md" | "REMINDER.md",
): string | null {
  const dir = seatDirFor(loaded, target);
  return dir ? path.join(dir, name) : null;
}

export function gateQueuePath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).gateQueue;
}

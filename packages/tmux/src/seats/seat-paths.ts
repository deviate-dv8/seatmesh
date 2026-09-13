import path from "node:path";
import {
  buildResolvedPaths,
  COLUMN_ID_RE,
  expandColumnAlias,
  isCoordKind,
  meshRuntimePaths,
  seatDirSegment,
  type LoadedProfile,
} from "@seat-mesh/core";

export interface SeatTarget {
  role: string;
  slot?: string | null;
  mini?: string | null;
}

/** CLI / peer target -> SeatTarget. slot-N, mini-N, or any profile column id. */
export function parseSeatTarget(raw: string): SeatTarget {
  const t = raw.trim().toLowerCase();
  const mini = t.match(/^(?:mini|manager-mini)-(\d+)$/);
  if (mini) return { role: "manager-mini", mini: mini[1] };
  const slot = t.match(/^(?:slot-)?(\d+)$/);
  if (slot) return { role: "worker", slot: slot[1] };
  const aliases = expandColumnAlias(t === "master" ? "manager" : t);
  const id =
    aliases.find((a) => a.includes("-") && COLUMN_ID_RE.test(a)) ??
    aliases.find((a) => COLUMN_ID_RE.test(a));
  if (id && id !== "worker" && id !== "mini") return { role: id };
  throw new Error(`bad seat target: ${raw} (want <column-id>|slot-N|mini-N)`);
}

/** Resolve tasks/agent-seats/<dir> for worker, mini, manager, secretary. */
export function seatDirFor(loaded: LoadedProfile, target: SeatTarget): string | null {
  const root = buildResolvedPaths(loaded).seatsRoot;
  const dirs = loaded.profile.seats.dirs;

  if (isCoordKind(target.role)) {
    return path.join(root, seatDirSegment(dirs, target.role));
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

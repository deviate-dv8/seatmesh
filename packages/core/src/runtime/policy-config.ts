import type { LoadedProfile } from "../profile/profile.js";
import type { MeshProfile } from "../schema/profile.js";
import { parseDurationToSeconds } from "../chatroom/duration.js";

/** Resolve PPA idle threshold (seconds). */
export function resolvePpaIdleSlackSec(profile: MeshProfile | LoadedProfile): number {
  const p = "profile" in profile ? profile.profile : profile;
  const n = p.ppa?.idleSlackSec;
  return typeof n === "number" && Number.isFinite(n) && n >= 30 ? Math.floor(n) : 120;
}

export function resolveAckRedirectDefaults(profile: MeshProfile | LoadedProfile): {
  ttlMin: number;
  ttlMs: number;
  rewriteTo: string;
  block: string;
} {
  const p = "profile" in profile ? profile.profile : profile;
  const r = p.acks?.redirect;
  const ttlMin = typeof r?.ttlMin === "number" && r.ttlMin >= 1 ? Math.floor(r.ttlMin) : 45;
  return {
    ttlMin,
    ttlMs: ttlMin * 60_000,
    rewriteTo: (r?.rewriteTo ?? "secretary").trim() || "secretary",
    block: (r?.block ?? "*managers").trim() || "*managers",
  };
}

export function resolveTargetTriageTo(profile: MeshProfile | LoadedProfile): string[] {
  const p = "profile" in profile ? profile.profile : profile;
  const raw = p.targets?.triageTo;
  if (Array.isArray(raw) && raw.length) {
    return [...new Set(raw.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  }
  return ["manager", "secretary"];
}

export function resolveCheckbackMaxFires(profile: MeshProfile | LoadedProfile): number {
  const p = "profile" in profile ? profile.profile : profile;
  const n = p.chatRooms?.checkback?.maxFires;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

export function resolveThinNotifyMinMs(profile: MeshProfile | LoadedProfile): number {
  const p = "profile" in profile ? profile.profile : profile;
  const raw = p.chatRooms?.thinNotify?.minInterval ?? "5m";
  const sec = parseDurationToSeconds(raw);
  if (sec == null || sec < 30) return 5 * 60 * 1000;
  return sec * 1000;
}

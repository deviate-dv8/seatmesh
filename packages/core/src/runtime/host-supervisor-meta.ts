/**
 * Shared read-side for the host-supervisor's own status file
 * (`~/.config/seatmesh/host-supervisor.json`, TODO 7.1). Was duplicated as a local
 * `interface HostMeta` in both `mesh-inbox-host-supervisor.ts` (the writer) and
 * `host-cli.ts` (a reader) — factored out here so a third reader (TODO 7.5, the
 * operator hub) doesn't duplicate it a third time.
 */
import fs from "node:fs";
import path from "node:path";
import { globalConfigDir } from "./global-registry.js";

export interface HostSupervisorSessionMeta {
  profilePath: string;
  session: string;
  port: number;
  pid?: number;
}

export interface HostSupervisorMeta {
  hostSupervisorPid: number;
  startedAt: string;
  rescanMs: number;
  sessions: HostSupervisorSessionMeta[];
}

export function hostSupervisorMetaPath(): string {
  return path.join(globalConfigDir(), "host-supervisor.json");
}

/** null when the host-supervisor has never run, or its meta file is unreadable/corrupt. */
export function readHostSupervisorMeta(): HostSupervisorMeta | null {
  try {
    return JSON.parse(fs.readFileSync(hostSupervisorMetaPath(), "utf8")) as HostSupervisorMeta;
  } catch {
    return null;
  }
}

/** profilePath -> its HostSupervisorSessionMeta, for an O(1) per-session lookup. */
export function hostSupervisorSessionsByProfilePath(
  meta: HostSupervisorMeta | null,
): Map<string, HostSupervisorSessionMeta> {
  const out = new Map<string, HostSupervisorSessionMeta>();
  if (!meta) return out;
  for (const s of meta.sessions) out.set(s.profilePath, s);
  return out;
}

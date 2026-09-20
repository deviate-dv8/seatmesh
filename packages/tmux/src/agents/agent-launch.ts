import {
  buildKindLaunchCmd,
  defaultCliForKind,
  knownAgentKindIds,
  runnersFromProfile,
  seatKindFromId,
  type AgentRunnerEntry,
  type LoadedProfile,
  type ResolvedAgentKind,
} from "@seat-mesh/core";
import { resolveKindsForProfile } from "@seat-mesh/providers";
import { cliForBaseColumn } from "../session/base-layout.js";
import { loadLaunchState } from "./agents-state.js";
import { buildAgentLaunchCmd } from "./agent-builder.js";
import {
  resolveLaunchCmd,
  seatAgentEntry,
  seatIdFromPaneRow,
} from "./agents-state.js";
import type { PaneRow } from "../lib/resolve-pane.js";
import { tmux } from "../lib/tmux-run.js";

/** Resolved kinds for this profile (provider kindBase ⊎ overlay ⊎ runners). */
export function kindsForLoaded(loaded: LoadedProfile): Record<string, ResolvedAgentKind> {
  return resolveKindsForProfile(loaded.profile, loaded.profileDir);
}

/** Profile-aware launch one-liner (kinds JSON + runners shim). */
export function buildProfileLaunchCmd(
  type: string,
  loaded: LoadedProfile,
  resumeId?: string | null,
): string | null {
  const runners = runnersFromProfile(loaded.profile);
  const kinds = kindsForLoaded(loaded);
  return buildLaunchCmdWithRunners(type, loaded.workspace, resumeId, runners, kinds);
}

export function buildLaunchCmdWithRunners(
  type: string,
  workspace: string,
  resumeId?: string | null,
  runners: Record<string, AgentRunnerEntry> = {},
  kinds?: Record<string, ResolvedAgentKind>,
): string | null {
  const custom = buildKindLaunchCmd(type, workspace, resumeId, runners, kinds);
  if (custom !== undefined && custom !== null) return custom;
  return buildAgentLaunchCmd(type, workspace, resumeId);
}

/** Known switch/set kind ids for this profile (open — includes custom extends). */
export function knownHarnessKinds(loaded: LoadedProfile): Set<string> {
  return knownAgentKindIds(kindsForLoaded(loaded));
}

/** Profile + mesh default harness type for any seat id. */
export function defaultHarnessTypeForSeat(loaded: LoadedProfile, seatId: string): string {
  const kinds = loaded.profile.layout?.base.kinds;
  const kind = seatKindFromId(seatId, kinds);
  const fromProfile = cliForBaseColumn(loaded, seatId);
  if (fromProfile) return fromProfile === "cursor-agent" ? "agent" : fromProfile;

  const state = loadLaunchState(loaded);
  const saved = seatAgentEntry(loaded, seatId, state);
  if (saved?.type && saved.type !== "empty") {
    return saved.type === "cursor-agent" ? "agent" : saved.type;
  }
  if (kind === "secretary") {
    return state.conventions?.secretary_default_cli ?? defaultCliForKind(kind);
  }
  if (kind === "mini") {
    return state.conventions?.mini_default_cli ?? defaultCliForKind(kind);
  }
  return defaultCliForKind(kind);
}

/** Launch one-liner for any seat switch/relaunch — one lookup path for all kinds. */
export function resolveSeatLaunchCmd(
  loaded: LoadedProfile,
  row: PaneRow,
  paneId: string,
  newType: string,
  keepRid: string | null,
  fresh: boolean,
  oldType: string,
): string | null {
  const harnessType = newType === "cursor-agent" ? "agent" : newType;
  const typeChanged = oldType !== newType && oldType !== "empty";
  const clearResume = fresh || typeChanged;

  const seatId = seatIdFromPaneRow(row);
  const saved = seatId ? seatAgentEntry(loaded, seatId) : null;
  let resumeId = clearResume ? null : keepRid;
  let resumeCmd = clearResume ? null : (saved?.resume_cmd ?? null);

  if (
    !resumeId &&
    !clearResume &&
    (harnessType === "opencode" || harnessType === "opencode-cpe")
  ) {
    const stored = tmux(["display-message", "-t", paneId, "-p", "#{@mesh_oc_session}"]).out.trim();
    if (stored) resumeId = stored;
  }

  const entry = {
    type: harnessType,
    resume_id: resumeId,
    resume_cmd: resumeCmd,
  };
  return (
    resolveLaunchCmd(entry, loaded.workspace, loaded) ??
    buildProfileLaunchCmd(harnessType, loaded, resumeId)
  );
}

/** @deprecated use resolveSeatLaunchCmd */
export const resolveSwitchLaunchCmd = resolveSeatLaunchCmd;

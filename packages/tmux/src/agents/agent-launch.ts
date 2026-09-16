import {
  buildKindLaunchCmd,
  defaultCliForKind,
  runnersFromProfile,
  seatKindFromId,
  type AgentRunnerEntry,
  type LoadedProfile,
} from "@seat-mesh/core";
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

/** Profile-aware launch one-liner (oc-proxy + custom runners). */
export function buildProfileLaunchCmd(
  type: string,
  loaded: LoadedProfile,
  resumeId?: string | null,
): string | null {
  const runners = runnersFromProfile(loaded.profile);
  return buildLaunchCmdWithRunners(type, loaded.workspace, resumeId, runners);
}

export function buildLaunchCmdWithRunners(
  type: string,
  workspace: string,
  resumeId?: string | null,
  runners: Record<string, AgentRunnerEntry> = {},
): string | null {
  const custom = buildKindLaunchCmd(type, workspace, resumeId, runners);
  if (custom !== undefined && custom !== null) return custom;
  return buildAgentLaunchCmd(type, workspace, resumeId);
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
    (harnessType === "opencode" || harnessType === "oc-proxy")
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

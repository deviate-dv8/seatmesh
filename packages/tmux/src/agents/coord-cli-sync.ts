import type {
  BaseColumn,
  LoadedProfile,
  PaneSnapshot,
  ProviderRegistry,
  ResolvedAgentKind,
} from "@seat-mesh/core";
import {
  entryWantsProxyRecovery,
  kindProveMatches,
  lookupResolvedKind,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { resolveLiveTmuxSession } from "../lib/live-session.js";
import { coordPaneForRole } from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { baseColumns, cliForBaseColumn } from "../session/base-layout.js";
import { saveMeshSession } from "../session/save-session.js";
import { loadLaunchState, resolveLaunchCmd, type AgentsStateFile, type PaneAgentState } from "./agents-state.js";
import { buildProfileLaunchCmd, kindsForLoaded } from "./agent-launch.js";
import { tryLaunchPane, type LaunchResult } from "./launch.js";
import { registryForProfile } from "./launch-verify.js";
import { liveHarnessSatisfiesWanted, resolveOpenCodeHarnessType } from "./opencode-cpe-live.js";

export type CoordSyncTrigger = "reload" | "attach";

export interface CoordSyncOptions {
  trigger?: CoordSyncTrigger;
}

function providerIdToHarnessType(id: string): string {
  if (id === "cursor-agent") return "agent";
  return id;
}

/** Coord panes repaired from profile layout (secretary). */
export function coordRepairRoles(loaded: LoadedProfile): BaseColumn[] {
  return baseColumns(loaded).filter((c) => c !== "manager");
}

/** mesh.config.yaml + mesh-agents.json `coordSync.reload` (default false). */
export function coordSyncDisruptLiveOnReload(
  loaded: LoadedProfile,
  conventions: AgentsStateFile["conventions"] | undefined,
): boolean {
  const meshOverride = conventions?.coord_sync?.reload;
  if (meshOverride !== undefined) return meshOverride;
  return loaded.profile.layout?.base?.coordSync?.reload ?? false;
}

export function coordSyncEnabledOnAttach(
  loaded: LoadedProfile,
  conventions: AgentsStateFile["conventions"] | undefined,
): boolean {
  const meshOverride = conventions?.coord_sync?.attach;
  if (meshOverride !== undefined) return meshOverride;
  return loaded.profile.layout?.base?.coordSync?.attach ?? true;
}

/** Scrollback / pane vars hint a live agent when process-tree detect is ambiguous. */
export function liveAgentUiVisible(snap: PaneSnapshot, profileCli: string): boolean {
  const tail = snap.captureTail;
  if (profileCli === "opencode" || profileCli === "opencode-cpe") {
    return (
      /ctrl\+p commands|Build auto\s+·|OpenCode\s+\d/i.test(tail) ||
      Boolean(snap.options.mesh_oc_session?.trim())
    );
  }
  if (profileCli === "agent") {
    return /Add a follow-up|ctrl\+c to stop|Composer\s+\d/i.test(tail);
  }
  if (profileCli === "claude") {
    return /claude|permission-mode/i.test(tail);
  }
  return false;
}

function savedCoordEntry(
  state: AgentsStateFile,
  role: BaseColumn,
): PaneAgentState | undefined {
  if (role === "secretary") {
    const sec = state.secretary;
    if (!sec) return undefined;
    return {
      type: sec.type ?? "opencode",
      name: "secretary",
      role: "secretary",
      resume_id: sec.resume_id ?? null,
      resume_cmd: sec.resume_cmd ?? null,
    };
  }
  const slot = state.coords?.[role];
  if (slot) {
    return { ...slot, name: role, role };
  }
  return undefined;
}

/** Profile `layout.base.cli` wins over stale mesh-agents secretary type (2026-09-13 OC crash). */
function profileCliForRole(
  loaded: LoadedProfile,
  _state: AgentsStateFile,
  role: BaseColumn,
): string {
  return cliForBaseColumn(loaded, role);
}

function secretaryWanted(state: AgentsStateFile): boolean {
  return state.secretary?.wanted !== false;
}

/**
 * Repair gate: relaunch only when profile CLI is missing or wrong type.
 * Never relaunch because capture is blank, rate-limited, busy, or typing.
 */
export function paneNeedsProfileCliFromSnap(
  registry: ProviderRegistry,
  snap: PaneSnapshot,
  profileCli: string,
  kinds?: Record<string, ResolvedAgentKind>,
): boolean {
  const prov = registry.detect(snap);
  if (!prov) {
    if (liveAgentUiVisible(snap, profileCli)) return false;
    return true;
  }
  const liveType = resolveOpenCodeHarnessType({
    detectId: prov.id,
    savedType: profileCli,
    snap,
    kinds,
  });
  if (liveHarnessSatisfiesWanted(liveType, profileCli, snap, { savedType: profileCli, kinds })) {
    return false;
  }
  if (liveType === "empty") return true;
  return liveType !== profileCli;
}

export function shouldLaunchCoordPane(
  registry: ProviderRegistry,
  snap: PaneSnapshot,
  profileCli: string,
  trigger: CoordSyncTrigger,
  disruptLiveOnReload: boolean,
  kinds?: Record<string, ResolvedAgentKind>,
): boolean {
  if (!paneNeedsProfileCliFromSnap(registry, snap, profileCli, kinds)) return false;
  if (trigger !== "reload" || disruptLiveOnReload) return true;
  const prov = registry.detect(snap);
  const liveType = prov ? providerIdToHarnessType(prov.id) : "empty";
  if (liveType === "empty") return true;
  if (liveAgentUiVisible(snap, profileCli)) return false;
  return false;
}

function launchCoordRole(
  loaded: LoadedProfile,
  state: AgentsStateFile,
  role: BaseColumn,
  paneId: string,
): LaunchResult {
  const profileCli = profileCliForRole(loaded, state, role);
  const saved = savedCoordEntry(state, role);
  const kinds = kindsForLoaded(loaded);
  const harnessType = profileCli === "cursor-agent" ? "agent" : profileCli;
  const wanted = lookupResolvedKind(kinds, harnessType);
  const keepResume =
    Boolean(saved) &&
    (saved!.type === harnessType ||
      (wanted?.prove != null &&
        (saved!.type === wanted.provider ||
          kindProveMatches(wanted, { resumeCmd: saved!.resume_cmd }) ||
          entryWantsProxyRecovery(
            { type: saved!.type, resume_cmd: saved!.resume_cmd ?? null },
            kinds,
          ))));
  const entry = {
    type: harnessType,
    resume_id: keepResume ? (saved?.resume_id ?? null) : null,
    resume_cmd: keepResume ? (saved?.resume_cmd ?? null) : null,
  };
  const cmd =
    resolveLaunchCmd(
      { ...saved, ...entry, role, name: role },
      loaded.workspace,
      loaded,
    ) ?? buildProfileLaunchCmd(harnessType, loaded, entry.resume_id);
  return tryLaunchPane(loaded, paneId, role, cmd, false, harnessType);
}

/** Profile + mesh-agents.json driven coord repair (layout.base.coordSync + conventions.coordSync). */
export function syncCoordClisFromProfile(
  loaded: LoadedProfile,
  opts: CoordSyncOptions = {},
): LaunchResult[] {
  const trigger = opts.trigger ?? "attach";
  const session = resolveLiveTmuxSession(loaded);
  const layout = loaded.profile.layout;
  if (!layout) return [];

  const state = loadLaunchState(loaded);

  if (trigger === "attach" && !coordSyncEnabledOnAttach(loaded, state.conventions)) {
    return [];
  }

  const disruptLiveOnReload = coordSyncDisruptLiveOnReload(loaded, state.conventions);
  const registry = registryForProfile(loaded);
  const kinds = kindsForLoaded(loaded);
  const results: LaunchResult[] = [];

  for (const role of coordRepairRoles(loaded)) {
    if (role === "secretary" && !secretaryWanted(state)) continue;

    const pane = coordPaneForRole(session, layout.base.window, role);
    if (!pane) continue;

    const profileCli = profileCliForRole(loaded, state, role);
    const snap = capturePaneSnapshot(pane);
    if (
      snap &&
      shouldLaunchCoordPane(registry, snap, profileCli, trigger, disruptLiveOnReload, kinds)
    ) {
      results.push(launchCoordRole(loaded, state, role, pane));
    }
  }

  if (results.some((r) => r.status === "launched")) {
    saveMeshSession(loaded, createRegistryForProfile(loaded.profile));
  }

  return results;
}

export function logCoordSyncResults(results: LaunchResult[]): void {
  for (const r of results) {
    if (r.status === "launched") {
      console.log(`coord-sync ${r.label} ${r.paneId} launched`);
    } else if (r.status === "failed") {
      console.warn(`coord-sync ${r.label} ${r.paneId} failed: ${r.reason ?? "?"}`);
    }
  }
}

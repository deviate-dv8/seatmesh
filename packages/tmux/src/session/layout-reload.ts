/**
 * layout reload — re-grid from profile, then repair panes from mesh-agents.json.
 * Invalid / empty shells with a saved harness get resume relaunch.
 */
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { spawnSync } from "node:child_process";
import {
  loadLaunchState,
  resolveLaunchCmd,
  seatAgentEntry,
} from "../agents/agents-state.js";
import { tryLaunchPane, type LaunchResult } from "../agents/launch.js";
import {
  logCoordSyncResults,
  syncCoordClisFromProfile,
} from "../agents/coord-cli-sync.js";
import { listPanes } from "../lib/resolve-pane.js";
import { paneHasAgentProcessTree } from "../lib/pane-idle.js";
import { resolveLiveTmuxSession } from "../lib/live-session.js";
import { assertRelayoutSafe } from "./layout-guard.js";
import { relayoutMeshSession } from "./session.js";
import { labelMeshSession } from "./labels.js";
import { applyMeshSessionBorders } from "./borders.js";
import { activeSessionWindows } from "./session-windows.js";
import { ensureSeatFiles } from "../seats/seat-init.js";
import { saveMeshSession } from "./save-session.js";

export interface LayoutReloadOpts {
  force?: boolean;
  skipMinisLeads?: boolean;
  /** Skip resume relaunch (grid + labels only). */
  noResume?: boolean;
}

function isPlainShell(cmd: string): boolean {
  return /^(zsh|bash|sh|fish|dash)$/i.test(cmd.trim()) || !cmd.trim();
}

function paneCurrentCommand(paneId: string): string {
  const r = spawnSync(
    "tmux",
    ["display-message", "-t", paneId, "-p", "#{pane_current_command}"],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").trim();
}

/** Cheap live type — prefer process tree when welcome wraps the CLI. */
function cheapLiveType(paneId: string): string {
  const cmd = paneCurrentCommand(paneId);
  if (!isPlainShell(cmd)) {
    if (/opencode-cpe|opencode/i.test(cmd)) return /cpe/i.test(cmd) ? "opencode-cpe" : "opencode";
    if (/^(agent|cursor-agent)$/i.test(cmd) || /cursor-agent/i.test(cmd)) return "agent";
    if (/^claude$/i.test(cmd)) return "claude";
    if (/kiro/i.test(cmd)) return "kiro";
  }
  if (paneHasAgentProcessTree(paneId)) {
    // Wrapper shell — still live harness; treat as opencode-ish for match purposes.
    return "opencode";
  }
  if (isPlainShell(cmd)) return "empty";
  return "empty";
}

function seatIdForRow(row: {
  role: string;
  slot: string;
  mini: string;
}): string | null {
  if (row.mini) return `mini-${row.mini}`;
  if (row.role === "worker" && row.slot) return `slot-${row.slot}`;
  if (row.role) return row.role;
  return null;
}

function typesMatch(wanted: string, live: string): boolean {
  const w = wanted === "cursor-agent" ? "agent" : wanted;
  const l = live === "cursor-agent" ? "agent" : live;
  if (w === l) return true;
  if (w === "opencode-cpe" && l === "opencode") return false;
  if (w === "opencode" && l === "opencode-cpe") return false;
  return false;
}

/**
 * Resume/relaunch seats whose mesh-agents.json type is non-empty but the pane
 * is a plain shell or the wrong CLI.
 * Strictly this profile's live tmux session — never foreign meshes.
 */
export function repairPanesFromMeshAgents(
  loaded: LoadedProfile,
): LaunchResult[] {
  const session = resolveLiveTmuxSession(loaded);
  const state = loadLaunchState(loaded);
  const results: LaunchResult[] = [];
  let panes;
  try {
    panes = listPanes(session);
  } catch {
    return results;
  }

  for (const row of panes) {
    if (row.session && row.session !== session) continue;
    if (loaded.workspaceId && row.workspaceId && row.workspaceId !== loaded.workspaceId) {
      continue;
    }
    const seatId = seatIdForRow(row);
    if (!seatId) continue;
    // Manager stays operator terminal unless explicitly launched.
    if (seatId === "manager" || seatId === "master") continue;

    const entry = seatAgentEntry(loaded, seatId, state);
    if (!entry?.type || entry.type === "empty") continue;

    const live = cheapLiveType(row.paneId);
    if (typesMatch(entry.type, live)) continue;

    const cmd = resolveLaunchCmd(entry, loaded.workspace, loaded);
    if (!cmd) {
      results.push({
        paneId: row.paneId,
        label: seatId,
        status: "skipped",
        reason: "no launch cmd",
      });
      continue;
    }

    // Kill junk CLI / shell, then paste resume from mesh-agents.
    if (live !== "empty") {
      spawnSync("tmux", ["respawn-pane", "-k", "-c", loaded.workspace, "-t", row.paneId], {
        encoding: "utf8",
      });
    }
    const r = tryLaunchPane(loaded, row.paneId, seatId, cmd, false, entry.type);
    results.push(r);
  }
  return results;
}

export interface LayoutReloadResult {
  repaired: LaunchResult[];
  saved?: string;
}

/** Relayout from profile, then repair invalid panes from mesh-agents.json. */
export function layoutReload(
  loaded: LoadedProfile,
  opts: LayoutReloadOpts = {},
): LayoutReloadResult {
  assertRelayoutSafe(loaded, opts.force ?? false);
  ensureSeatFiles(loaded);
  const session = resolveLiveTmuxSession(loaded);
  relayoutMeshSession(loaded, {
    skipMinisLeads: opts.skipMinisLeads,
    force: opts.force,
    save: false,
  });
  labelMeshSession(loaded, session);
  applyMeshSessionBorders(session, activeSessionWindows(loaded, session));
  logCoordSyncResults(syncCoordClisFromProfile(loaded, { trigger: "reload" }));

  let repaired: LaunchResult[] = [];
  if (!opts.noResume) {
    repaired = repairPanesFromMeshAgents(loaded);
  }

  const registry: ProviderRegistry = createRegistryForProfile(loaded.profile);
  const saved = saveMeshSession(loaded, registry);
  return { repaired, saved };
}

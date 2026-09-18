/**
 * Auto-revive seats that died back to a plain shell (agent/opencode/CPE kill).
 * Uses mesh-agents.json type + resume — not profile layout empty seats.
 *
 * Important: welcome wrappers keep `#{pane_current_command}` as bash while
 * opencode-cpe runs as a child — use paneIsIdleShell (process tree), not bare
 * pane_current_command, or we re-launch healthy panes every cooldown.
 */
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  loadLaunchState,
  resolveLaunchCmd,
  seatAgentEntry,
  tryLaunchPane,
  listPanes,
  resolveLiveTmuxSession,
  paneIsIdleShell,
} from "@seat-mesh/tmux";

export interface PaneAutoReviveCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  log: (line: string) => void;
}

const lastReviveAt = new Map<string, number>();

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

/**
 * Relaunch empty shells that still have a non-empty harness in mesh-agents.
 * Cooldown per pane. Returns revived count.
 */
export function pollPaneAutoRevive(ctx: PaneAutoReviveCtx): number {
  // Opt-in only — default off so a kill stays a shell until explicit launch/atomics.
  if (ctx.loaded.profile.daemon?.autoRevive !== true) return 0;
  const cooldownMs = (ctx.loaded.profile.daemon?.autoReviveCooldownSec ?? 60) * 1000;
  const now = Date.now();
  const session = resolveLiveTmuxSession(ctx.loaded);
  let panes;
  try {
    panes = listPanes(session);
  } catch {
    return 0;
  }
  if (!panes.length) return 0;

  const state = loadLaunchState(ctx.loaded);
  let revived = 0;

  for (const row of panes) {
    if (row.session && row.session !== session) continue;
    if (
      ctx.loaded.workspaceId &&
      row.workspaceId &&
      row.workspaceId !== ctx.loaded.workspaceId
    ) {
      continue;
    }
    const seatId = seatIdForRow(row);
    if (!seatId) continue;
    // Manager stays operator terminal — never auto-revive into OC/agent.
    if (seatId === "manager" || seatId === "master") continue;
    const entry = seatAgentEntry(ctx.loaded, seatId, state);
    if (!entry?.type || entry.type === "empty") continue;

    // bash wrapping opencode-cpe.sh ≠ empty shell
    if (!paneIsIdleShell(row.paneId)) continue;

    const last = lastReviveAt.get(row.paneId) ?? 0;
    if (now - last < cooldownMs) continue;

    const launchCmd = resolveLaunchCmd(entry, ctx.loaded.workspace, ctx.loaded);
    if (!launchCmd) continue;

    lastReviveAt.set(row.paneId, now);
    const result = tryLaunchPane(
      ctx.loaded,
      row.paneId,
      seatId,
      launchCmd,
      false,
      entry.type,
    );
    if (result.status === "launched") {
      revived += 1;
      ctx.log(
        `AUTO-REVIVE ${seatId} ${row.paneId} type=${entry.type}${entry.resume_id ? ` ses=${entry.resume_id}` : ""}`,
      );
    } else {
      ctx.log(
        `AUTO-REVIVE skip ${seatId} ${row.paneId}: ${result.reason ?? result.status}`,
      );
    }
  }
  return revived;
}

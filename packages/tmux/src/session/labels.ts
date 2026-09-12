import type { BaseColumn, LoadedProfile } from "@seat-mesh/core";
import { normalizeMinisLeads, portsForSlot } from "@seat-mesh/core";
import { tmux, tmuxHasSession } from "../lib/tmux-run.js";
import { baseColumns, ensureBaseLayout } from "./base-layout.js";
import { coordPaneForRole, listMeshMinis, listMeshWorkers } from "../lib/pane-meta.js";
import { listWindowPaneIds } from "./window-panes.js";
import { inboxHealth, meshInboxPort } from "../comms/inbox-bridge.js";
import { resolveLiveTmuxSession } from "../lib/live-session.js";
import { ensureMeshSessionEnv } from "./session-env.js";

function setPaneOptions(pane: string, pairs: Record<string, string>): void {
  for (const [k, v] of Object.entries(pairs)) {
    const r = tmux(["set-option", "-p", "-t", pane, `@${k}`, v]);
    if (!r.ok) throw new Error(`set @${k} on ${pane}: ${r.err || r.out}`);
  }
}

function paneOpt(paneId: string, key: string): string {
  return tmux(["display-message", "-t", paneId, "-p", `#{@${key}}`]).out.trim();
}

export function stampBaseColumn(paneId: string, col: BaseColumn): void {
  if (col === "manager" || col === "manager-2") {
    setPaneOptions(paneId, {
      mesh_role: col,
      mesh_slot: col,
      mesh_ports: col,
      mesh_title: col,
      mesh_lead: "",
    });
    return;
  }
  setPaneOptions(paneId, {
    mesh_role: "secretary",
    mesh_slot: "secretary",
    mesh_ports: "secretary",
    mesh_title: "secretary",
    mesh_lead: "",
  });
}

export function stampWorkerSlot(loaded: LoadedProfile, paneId: string, slot: number): void {
  setPaneOptions(paneId, {
    mesh_role: "worker",
    mesh_slot: String(slot),
    mesh_ports: portsForSlot(loaded.profile.ports.worker, slot),
    mesh_title: `slot-${slot}`,
    mesh_mini: "",
  });
}

export function stampMiniId(
  loaded: LoadedProfile,
  paneId: string,
  n: number,
  isLead: boolean,
): void {
  setPaneOptions(paneId, {
    mesh_role: "manager-mini",
    mesh_slot: `mini-${n}`,
    mesh_ports: isLead ? `mini-${n}·lead` : `mini-${n}`,
    mesh_mini: String(n),
    mesh_title: `mini-${n}`,
    mesh_lead: isLead ? "1" : "",
  });
}

function nextFreeSlot(used: Set<number>, max: number): number | null {
  for (let s = 1; s <= max; s++) {
    if (!used.has(s)) return s;
  }
  return null;
}

function assignBaseIdentities(loaded: LoadedProfile, session: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;
  const baseWin = layout.base.window;

  for (const col of baseColumns(loaded)) {
    const pane = coordPaneForRole(session, baseWin, col);
    if (pane) stampBaseColumn(pane, col);
  }

  const panes = listWindowPaneIds(session, baseWin);
  const unlabeled = panes.filter((p) => !paneOpt(p, "mesh_role"));
  if (unlabeled.length === 0) return;

  if (panes.length >= 2) {
    const cols = baseColumns(loaded);
    if (!coordPaneForRole(session, baseWin, cols[0] ?? "manager") && unlabeled[0]) {
      stampBaseColumn(unlabeled[0], cols[0] ?? "manager");
    }
    if (!coordPaneForRole(session, baseWin, "secretary")) {
      const sec = unlabeled.find((p) => p !== unlabeled[0]) ?? unlabeled[1];
      if (sec) stampBaseColumn(sec, "secretary");
    }
  } else if (unlabeled[0]) {
    stampBaseColumn(unlabeled[0], "manager");
  }
}

function assignWorkerIdentities(loaded: LoadedProfile, session: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;
  const workersWin = layout.workers.window;
  const max = loaded.profile.session.workerCount;
  const used = new Set<number>();
  for (const m of listMeshWorkers(session, workersWin)) {
    const n = Number(m.slot);
    if (n >= 1 && n <= max) {
      used.add(n);
      stampWorkerSlot(loaded, m.paneId, n);
    }
  }
  for (const paneId of listWindowPaneIds(session, workersWin)) {
    if (paneOpt(paneId, "mesh_role")) continue;
    const n = nextFreeSlot(used, max);
    if (n == null) break;
    used.add(n);
    stampWorkerSlot(loaded, paneId, n);
  }
}

function assignMiniIdentities(loaded: LoadedProfile, session: string): void {
  const layout = loaded.profile.layout;
  if (!layout) return;
  const minisWin = layout.minis.window;
  const miniMax = loaded.profile.session.miniMax;
  const leads = normalizeMinisLeads(layout.minis.leads);
  const leadIds = new Set(leads.map(String));
  const used = new Set<number>();
  for (const m of listMeshMinis(session, minisWin)) {
    const n = Number(m.mini);
    if (n >= 1 && n <= miniMax) {
      used.add(n);
      stampMiniId(loaded, m.paneId, n, leadIds.has(String(n)));
    }
  }
  for (const paneId of listWindowPaneIds(session, minisWin)) {
    if (paneOpt(paneId, "mesh_mini")) continue;
    let n = Number(paneOpt(paneId, "mesh_slot").replace(/^mini-/, ""));
    if (!Number.isFinite(n) || n < 1 || n > miniMax || used.has(n)) {
      n = nextFreeSlot(used, miniMax) ?? 0;
    }
    if (n < 1 || n > miniMax) continue;
    used.add(n);
    stampMiniId(loaded, paneId, n, leadIds.has(String(n)));
  }
}

function stampWorkspaceOnSession(loaded: LoadedProfile, session: string): void {
  const wid = loaded.workspaceId;
  for (const win of [
    loaded.profile.layout?.base.window,
    loaded.profile.layout?.workers.window,
    loaded.profile.layout?.minis.window,
    loaded.profile.layout?.nvim.window,
  ]) {
    if (!win) continue;
    for (const paneId of listWindowPaneIds(session, win)) {
      tmux(["set-option", "-p", "-t", paneId, "@mesh_workspace_id", wid]);
    }
  }
}

/** Assign @mesh_* on panes from pane options first; fill gaps for new panes only. */
export function assignPaneIdentities(loaded: LoadedProfile, session: string): void {
  assignBaseIdentities(loaded, session);
  assignWorkerIdentities(loaded, session);
  assignMiniIdentities(loaded, session);
  stampWorkspaceOnSession(loaded, session);
}

const COORD_INBOX_DOWN = "INBOX[DOWN]";

function tmuxSetPaneOpt(paneId: string, key: string, value: string): void {
  tmux(["set-option", "-p", "-t", paneId, `@${key}`, value]);
}

/**
 * When mesh inbox daemon is unreachable, stamp coord panes so borders show INBOX[DOWN].
 * When healthy, clear a stale INBOX[DOWN] status (daemon drain will repaint composer state).
 */
export function stampCoordInboxBorderHealth(loaded: LoadedProfile, session: string): boolean {
  const layout = loaded.profile.layout;
  if (!layout) return false;
  const baseWin = layout.base.window;
  const up = Boolean(inboxHealth(meshInboxPort(loaded)));
  for (const col of baseColumns(loaded)) {
    const pane = coordPaneForRole(session, baseWin, col);
    if (!pane) continue;
    if (!up) {
      tmuxSetPaneOpt(pane, "mesh_status", COORD_INBOX_DOWN);
      continue;
    }
    const cur = tmux(["display-message", "-t", pane, "-p", "#{@mesh_status}"]).out.trim();
    if (cur === COORD_INBOX_DOWN) {
      tmuxSetPaneOpt(pane, "mesh_status", "");
    }
  }
  return up;
}

/** Resolve the tmux session that exists for this profile (legacy `mesh` or scoped `mesh-<hash>`). */
export function liveMeshSession(loaded: LoadedProfile, hint?: string): string {
  if (hint && tmuxHasSession(hint)) return hint;
  return resolveLiveTmuxSession(loaded);
}

/** Refresh ports/titles from existing @mesh_* (pane identity — not window index). */
export function labelMeshSession(loaded: LoadedProfile, session?: string): void {
  const live = liveMeshSession(loaded, session);
  ensureMeshSessionEnv(live, {
    workspaceId: loaded.workspaceId,
    sessionName: loaded.sessionName,
  });
  ensureBaseLayout(loaded, live);
  assignPaneIdentities(loaded, live);
  stampCoordInboxBorderHealth(loaded, live);
}

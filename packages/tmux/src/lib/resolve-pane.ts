import { spawnSync } from "node:child_process";
import type { LoadedProfile } from "@seat-mesh/core/profile";
import { baseColumnIds, expandColumnAlias } from "@seat-mesh/core/seat-kind";
import {
  resolveLiveTmuxSession,
  sessionWorkspaceId,
  sessionsForWorkspace,
} from "./live-session.js";
import { tmuxHasSession } from "./tmux-run.js";

export interface PaneRow {
  paneId: string;
  session: string;
  window: string;
  role: string;
  slot: string;
  ports: string;
  mini: string;
  workspaceId: string;
}

export type ResolvePaneContext = string | LoadedProfile;

function tmux(args: string[]): string | null {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trim() || null;
}

function parsePaneList(out: string | null): PaneRow[] {
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        paneId,
        sessionName,
        window,
        meshRole,
        meshSlot,
        meshPorts,
        meshMini,
        meshWorkspaceId,
      ] = line.split("\t");
      return {
        paneId,
        session: sessionName,
        window,
        role: meshRole || "",
        slot: meshSlot || "",
        ports: meshPorts || "",
        mini: meshMini || "",
        workspaceId: meshWorkspaceId || "",
      };
    });
}

const PANE_LIST_FMT =
  "#{pane_id}\t#{session_name}\t#{window_name}\t#{@mesh_role}\t#{@mesh_slot}\t#{@mesh_ports}\t#{@mesh_mini}\t#{@mesh_workspace_id}";

/**
 * List panes for one tmux session.
 * Empty/whitespace session is refused — never fall through to host-wide `-a`
 * (that would let kill/reload touch foreign meshes).
 */
export function listPanes(session: string): PaneRow[] {
  if (!session?.trim()) {
    throw new Error("listPanes: empty session refused (would list all tmux panes)");
  }
  return parsePaneList(tmux(["list-panes", "-s", "-t", session, "-F", PANE_LIST_FMT]));
}

/** Host-wide pane list — debug / legacy resolve only. Prefer listPanes(session). */
export function listAllPanes(): PaneRow[] {
  return parsePaneList(tmux(["list-panes", "-a", "-F", PANE_LIST_FMT]));
}

function workspaceIdFromContext(ctx: ResolvePaneContext): string | null {
  return typeof ctx === "string" ? null : ctx.workspaceId;
}

function liveSessionFromContext(ctx: ResolvePaneContext): string {
  if (typeof ctx === "string") return ctx;
  return resolveLiveTmuxSession(ctx);
}

/** Panes for one mesh workspace only — never all tmux sessions on the host. */
export function listPanesForMesh(ctx: ResolvePaneContext): PaneRow[] {
  const workspaceId = workspaceIdFromContext(ctx);
  if (workspaceId) {
    const sessions = sessionsForWorkspace(workspaceId);
    if (sessions.length) {
      return sessions.flatMap((s) => listPanes(s));
    }
    const live = liveSessionFromContext(ctx);
    if (tmuxHasSession(live)) return listPanes(live);
    return [];
  }
  const live = liveSessionFromContext(ctx);
  return tmuxHasSession(live) ? listPanes(live) : [];
}

function paneMatchesWorkspace(row: PaneRow, workspaceId: string | null): boolean {
  if (!workspaceId) return true;
  if (row.workspaceId) return row.workspaceId === workspaceId;
  const sid = sessionWorkspaceId(row.session);
  // Unknown session stamp ≠ match — never treat foreign/unstamped as ours.
  return sid === workspaceId;
}

/**
 * Find a pane in the live mesh session only.
 * LoadedProfile never falls through to another tmux session (even same workspace_id).
 */
function findInMesh(
  ctx: ResolvePaneContext,
  pred: (p: PaneRow) => boolean,
): PaneRow | undefined {
  const workspaceId = workspaceIdFromContext(ctx);
  const live = liveSessionFromContext(ctx);
  if (!tmuxHasSession(live)) return undefined;
  return listPanes(live).find((p) => pred(p) && paneMatchesWorkspace(p, workspaceId));
}

/** Refuse mutations that would touch a foreign tmux session. */
export function assertPaneInLiveSession(
  row: PaneRow,
  loaded: LoadedProfile,
): void {
  const live = resolveLiveTmuxSession(loaded);
  if (row.session && row.session !== live) {
    throw new Error(
      `refused: pane ${row.paneId} is in session '${row.session}', not live '${live}'`,
    );
  }
  if (loaded.workspaceId && !paneMatchesWorkspace(row, loaded.workspaceId)) {
    throw new Error(
      `refused: pane ${row.paneId} is not in workspace_id=${loaded.workspaceId}`,
    );
  }
}

/** slot-first: bare 1-8, slot-N, pane-N/pN, manager, mini-N, %id, here */
export function resolvePaneTarget(
  arg?: string,
  ctx: ResolvePaneContext = "dev",
): { paneId: string; row: PaneRow } | { error: string } {
  const raw = (arg ?? "").trim();
  const workspaceId = workspaceIdFromContext(ctx);

  if (!raw || raw === "here" || raw === "self") {
    const paneId = process.env.TMUX_PANE;
    if (!paneId) {
      return {
        error:
          "not in tmux — pass a target: seatmesh --profile .sm agent whoami <1-8|slot-N|manager|mini-N|%id>",
      };
    }
    const row =
      listPanesForMesh(ctx).find((p) => p.paneId === paneId) ??
      (!workspaceId ? listAllPanes().find((p) => p.paneId === paneId) : undefined);
    if (!row) return { error: `pane ${paneId} not found` };
    if (workspaceId && !paneMatchesWorkspace(row, workspaceId)) {
      return { error: `pane ${paneId} is not in workspace_id=${workspaceId}` };
    }
    return { paneId, row };
  }

  if (raw.startsWith("%")) {
    const row =
      listPanesForMesh(ctx).find((p) => p.paneId === raw) ??
      (!workspaceId ? listAllPanes().find((p) => p.paneId === raw) : undefined);
    if (!row) {
      return {
        error: workspaceId
          ? `pane ${raw} not in workspace_id=${workspaceId} (no host-wide fallback)`
          : `pane ${raw} not found`,
      };
    }
    if (workspaceId && !paneMatchesWorkspace(row, workspaceId)) {
      return { error: `pane ${raw} is not in workspace_id=${workspaceId}` };
    }
    return { paneId: raw, row };
  }

  if (raw === "manager-b" || raw === "master-b" || raw === "co-manager") {
    return {
      error: "manager-b removed — use a profile column id or room say -r managers",
    };
  }

  // Hot path first: slot-N / bare N (spawn/switch). Avoid column findInMesh fanout.
  const slotMatch = raw.match(/^(?:slot-)?(\d+)$/);
  if (slotMatch) {
    const slot = slotMatch[1];
    const row = findInMesh(ctx, (p) => p.slot === slot && p.role === "worker");
    if (!row) {
      const live = liveSessionFromContext(ctx);
      return { error: `slot ${slot} pane not found in mesh session '${live}'` };
    }
    return { paneId: row.paneId, row };
  }

  const miniMatch = raw.match(/^(?:mini|manager-mini)-(\d+)$/);
  if (miniMatch) {
    const n = miniMatch[1];
    const row = findInMesh(
      ctx,
      (p) =>
        (p.mini === n || p.slot === `mini-${n}`) &&
        (p.role === "manager-mini" || Boolean(p.mini)),
    );
    if (!row) return { error: `mini-${n} pane not found` };
    return { paneId: row.paneId, row };
  }

  if (raw === "manager-mini") {
    const minis = listPanesForMesh(ctx).filter(
      (p) => p.role === "manager-mini" || (p.mini && p.mini.length > 0),
    );
    if (minis.length === 1) {
      return { paneId: minis[0].paneId, row: minis[0] };
    }
    return {
      error: `bad target: manager-mini (ambiguous — use mini-N or manager-mini-N; ${minis.length} minis live)`,
    };
  }

  const columnIds =
    typeof ctx === "string" ? ["manager", "secretary"] : baseColumnIds(ctx.profile.layout);
  const want = new Set(expandColumnAlias(raw));
  if (want.has("master")) want.add("manager");
  const colHit = findInMesh(ctx, (p) => want.has(p.role) || columnIds.some((c) => want.has(c) && p.role === c));
  if (colHit) return { paneId: colHit.paneId, row: colHit };
  if (columnIds.some((c) => want.has(c))) {
    const live = liveSessionFromContext(ctx);
    return { error: `no ${raw} pane in mesh session '${live}'` };
  }
  const roleHit = findInMesh(ctx, (p) => want.has(p.role));
  if (roleHit) return { paneId: roleHit.paneId, row: roleHit };

  const paneIdx = raw.match(/^(?:pane-)?p?(\d+)$/i);
  if (paneIdx && raw !== "pane-0" && raw !== "0") {
    const paneId = tmux(["display-message", "-t", raw, "-p", "#{pane_id}"]);
    if (paneId?.startsWith("%")) {
      const row = listPanesForMesh(ctx).find((p) => p.paneId === paneId);
      if (row) return { paneId, row };
    }
  }

  if (raw.includes(":") || raw.includes(".")) {
    const paneId = tmux(["display-message", "-t", raw, "-p", "#{pane_id}"]);
    if (paneId?.startsWith("%")) {
      const row = listPanesForMesh(ctx).find((p) => p.paneId === paneId);
      if (row) return { paneId, row };
      return {
        paneId,
        row: {
          paneId,
          session: liveSessionFromContext(ctx),
          window: "?",
          role: "",
          slot: "",
          ports: "",
          mini: "",
          workspaceId: workspaceId ?? "",
        },
      };
    }
  }

  return {
    error: `bad target: ${raw} (want here | self | slot-N | mini-N | <column-id> | %id)`,
  };
}

import { spawnSync } from "node:child_process";
import {
  baseColumnIds,
  expandColumnAlias,
  type LoadedProfile,
} from "@seat-mesh/core";
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

export function listPanes(session?: string): PaneRow[] {
  const args = [
    "list-panes",
    ...(session ? ["-s", "-t", session] : ["-a"]),
    "-F",
    "#{pane_id}\t#{session_name}\t#{window_name}\t#{@mesh_role}\t#{@mesh_slot}\t#{@mesh_ports}\t#{@mesh_mini}\t#{@mesh_workspace_id}",
  ];
  const out = tmux(args);
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
  return sid === workspaceId || sid === null;
}

function findInMesh(
  ctx: ResolvePaneContext,
  pred: (p: PaneRow) => boolean,
): PaneRow | undefined {
  const workspaceId = workspaceIdFromContext(ctx);
  const live = liveSessionFromContext(ctx);
  const inLive = listPanes(live).find((p) => pred(p) && paneMatchesWorkspace(p, workspaceId));
  if (inLive) return inLive;
  for (const row of listPanesForMesh(ctx)) {
    if (row.session === live) continue;
    if (pred(row) && paneMatchesWorkspace(row, workspaceId)) return row;
  }
  return undefined;
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
      listPanes().find((p) => p.paneId === paneId);
    if (!row) return { error: `pane ${paneId} not found` };
    if (workspaceId && !paneMatchesWorkspace(row, workspaceId)) {
      return { error: `pane ${paneId} is not in workspace_id=${workspaceId}` };
    }
    return { paneId, row };
  }

  if (raw.startsWith("%")) {
    const row =
      listPanesForMesh(ctx).find((p) => p.paneId === raw) ??
      listPanes().find((p) => p.paneId === raw);
    if (!row) return { error: `pane ${raw} not found` };
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

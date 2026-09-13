import { isManagerKind, isSecretaryKind } from "@seat-mesh/core";
import { tmux } from "./tmux-run.js";

/** Tab-separated — tmux collapses empty space-separated fields. */
export const PANE_META_FMT =
  "#{pane_id}\t#{@mesh_role}\t#{@mesh_slot}\t#{@mesh_mini}\t#{@mesh_ports}";

export interface MeshPaneMeta {
  paneId: string;
  role: string;
  slot: string;
  mini: string;
  ports: string;
}

export function parsePaneMetaLine(line: string): MeshPaneMeta | null {
  const parts = line.trim().split("\t");
  if (!parts[0]?.startsWith("%")) return null;
  let slot = parts[2] || "";
  let mini = parts[3] || "";
  if (slot.startsWith("mini-")) {
    mini = slot.slice(5);
    slot = "";
  }
  return {
    paneId: parts[0],
    role: parts[1] || "",
    slot,
    mini,
    ports: parts[4] || "",
  };
}

function listWindowMeta(session: string, window: string): MeshPaneMeta[] {
  const target = `${session}:${window}`;
  const out = tmux(["list-panes", "-t", target, "-F", PANE_META_FMT]).out;
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => parsePaneMetaLine(line))
    .filter((m): m is MeshPaneMeta => m !== null);
}

export function listMeshWorkers(session: string, workersWindow: string): MeshPaneMeta[] {
  return listWindowMeta(session, workersWindow)
    .filter((m) => {
      const n = Number(m.slot);
      return m.role === "worker" && n >= 1;
    })
    .sort((a, b) => Number(a.slot) - Number(b.slot));
}

/** Worker pane by @mesh_slot (not pane_index). */
export function resolveWorkerPaneId(
  session: string,
  window: string,
  slot: number,
): string | null {
  for (const m of listMeshWorkers(session, window)) {
    if (Number(m.slot) === slot) return m.paneId;
  }
  return null;
}

export function listMeshMinis(session: string, minisWindow: string): MeshPaneMeta[] {
  return listWindowMeta(session, minisWindow).filter((m) => /^[1-9]$/.test(m.mini));
}

export function meshManagerPane(session: string, baseWindow: string): string | null {
  const rows = listWindowMeta(session, baseWindow);
  for (const m of rows) {
    if (m.role === "manager") return m.paneId;
  }
  for (const m of rows) {
    if (isManagerKind(m.role)) return m.paneId;
  }
  return rows[0]?.paneId ?? null;
}

/** Resolve a base-window coord pane by @mesh_role (profile layout driven). */
export function coordPaneForRole(
  session: string,
  baseWindow: string,
  role: string,
): string | null {
  for (const m of listWindowMeta(session, baseWindow)) {
    if (m.role === role) return m.paneId;
  }
  return null;
}

export function meshManagerPanes(session: string, baseWindow: string): string[] {
  const out: string[] = [];
  for (const m of listWindowMeta(session, baseWindow)) {
    if (isManagerKind(m.role)) out.push(m.paneId);
  }
  return out;
}

export function meshSecretaryPane(session: string, baseWindow: string): string | null {
  for (const m of listWindowMeta(session, baseWindow)) {
    if (isSecretaryKind(m.role)) return m.paneId;
  }
  return null;
}

/** Single-pane meta via tmux display-message (for checkback reply routing). */
export function paneMetaForPane(paneId: string): MeshPaneMeta | null {
  if (!paneId?.startsWith("%")) return null;
  const out = tmux(["display-message", "-t", paneId, "-p", PANE_META_FMT]).out;
  if (!out) return null;
  return parsePaneMetaLine(out);
}

export function listMeshMonitorPanes(
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
): { paneId: string; label: string }[] {
  const out: { paneId: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (paneId: string, label: string) => {
    if (!paneId || seen.has(paneId)) return;
    seen.add(paneId);
    out.push({ paneId, label });
  };
  for (const w of listMeshWorkers(session, workersWindow)) {
    add(w.paneId, `slot-${w.slot}`);
  }
  for (const m of listMeshMinis(session, minisWindow)) {
    add(m.paneId, `mini-${m.mini}`);
  }
  for (const m of listWindowMeta(session, baseWindow)) {
    if (m.role) add(m.paneId, m.role);
  }
  return out;
}

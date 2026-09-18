import fs from "node:fs";
import path from "node:path";
import { parseGridSpec, type LoadedProfile } from "@seat-mesh/core";
import { loadMinisState } from "../roles/minis.js";
import type { MeshPaneMeta } from "../lib/pane-meta.js";
import { listMeshMinis, listMeshWorkers, PANE_META_FMT } from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { tmux } from "../lib/tmux-run.js";
import { listWindowPaneIds } from "./window-panes.js";
import { resolveLiveTmuxSession } from "../lib/live-session.js";

const CLI_CMD_RE =
  /\b(agent|opencode|claude|kiro|opencode-cpe|cursor-agent)\b/i;
const BUSY_TAIL_RE = /Working|Running|Thinking|ctrl\+c to stop/;
const LIMIT_TAIL_RE =
  /rate limit|usage limit|Cannot connect to API|unable to connect/i;
const ACTIVE_STATUS_RE =
  /\b(BUSY|BLOCKED|Working|Running|Thinking|typing|OC-LIMIT|CC-LIMIT|PROXY-DOWN)\b/i;

export interface LayoutPaneRisk {
  label: string;
  paneId: string;
  window: string;
  reasons: string[];
}

export interface LayoutRelayoutRisk {
  workers: LayoutPaneRisk[];
  minis: LayoutPaneRisk[];
}

function readWorkerFocusMark(loaded: LoadedProfile, slot: string): string | null {
  const n = slot.replace(/^slot-/, "");
  const root = path.join(loaded.workspace, loaded.profile.seats.root);
  const pat = loaded.profile.seats.dirs?.worker ?? "slot-{n}";
  const file = path.join(root, pat.replace("{n}", n), "FOCUS.md");
  try {
    const text = fs.readFileSync(file, "utf8");
    const m = text.match(/\*\*Mark:\*\*\s*([A-Z]+)/i);
    return m?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

function paneLabel(meta: MeshPaneMeta): string {
  if (meta.role === "worker" && meta.slot) return `slot-${meta.slot}`;
  if (meta.mini) return `mini-${meta.mini}`;
  return meta.role || meta.paneId;
}

export function activityReasonsForMeta(loaded: LoadedProfile, meta: MeshPaneMeta): string[] {
  return activityReasons(loaded, meta);
}

function activityReasons(loaded: LoadedProfile, meta: MeshPaneMeta): string[] {
  const reasons: string[] = [];

  const status =
    tmux(["display-message", "-t", meta.paneId, "-p", "#{@mesh_status}"]).out ?? "";
  if (status && ACTIVE_STATUS_RE.test(status)) {
    reasons.push(`border: ${status.trim()}`);
  }

  const snap = capturePaneSnapshot(meta.paneId);
  if (snap) {
    const cmdBlob = snap.options.processCmdlines ?? "";
    if (CLI_CMD_RE.test(cmdBlob) || CLI_CMD_RE.test(snap.currentCommand)) {
      reasons.push("live CLI");
    }
    const tail = snap.captureTail;
    if (BUSY_TAIL_RE.test(tail)) {
      const m = tail.match(/(Working|Running|Thinking[^\n]*|ctrl\+c to stop)/);
      reasons.push(`CLI ${m?.[1] ?? "busy"}`);
    } else if (LIMIT_TAIL_RE.test(tail)) {
      reasons.push("CLI limit/connect");
    } else if (/AFK|Stuck|draft/i.test(tail)) {
      reasons.push("CLI afk/draft");
    }
  }

  if (meta.role === "worker" && meta.slot) {
    const mark = readWorkerFocusMark(loaded, meta.slot);
    if (mark === "BUSY" || mark === "BLOCKED") {
      reasons.push(`FOCUS Mark ${mark}`);
    }
  }

  if (meta.mini) {
    const state = loadMinisState(loaded);
    const row = state.minis[meta.mini];
    if (row?.status === "spawned") {
      const hub = row.hub && row.hub !== "-" ? row.hub : "open task";
      reasons.push(`mini spawned (${hub})`);
    } else if (row?.status === "failed") {
      reasons.push("mini failed (needs review)");
    }
  }

  return reasons;
}

function doomedMetaForWindow(
  session: string,
  window: string,
  targetCount: number,
): MeshPaneMeta[] {
  const paneIds = listWindowPaneIds(session, window);
  if (paneIds.length <= targetCount) return [];

  const doomedIds = new Set(paneIds.slice(targetCount));
  const out = tmux(["list-panes", "-t", `${session}:${window}`, "-F", PANE_META_FMT]).out;
  if (!out) return [];

  const doomed: MeshPaneMeta[] = [];
  for (const line of out.split("\n")) {
    const parts = line.trim().split("\t");
    const paneId = parts[0] ?? "";
    if (!paneId.startsWith("%") || !doomedIds.has(paneId)) continue;
    let slot = parts[2] || "";
    let mini = parts[3] || "";
    if (slot.startsWith("mini-")) {
      mini = slot.slice(5);
      slot = "";
    }
    doomed.push({
      paneId,
      role: parts[1] || "",
      slot,
      mini,
      ports: parts[4] || "",
    });
  }
  return doomed;
}

/** Panes that would be killed when shrinking a window to targetCount. */
export function assessRelayoutShrinkRisk(loaded: LoadedProfile): LayoutRelayoutRisk {
  const session = resolveLiveTmuxSession(loaded);
  const layout = loaded.profile.layout;
  if (!layout) return { workers: [], minis: [] };

  const workerTarget = loaded.profile.session.workerCount;
  const { cols, rows } = parseGridSpec(layout.minis.grid);
  const miniTarget = layout.minis.max;
  if (miniTarget !== cols * rows) {
    throw new Error(
      `minis.max ${miniTarget} must equal ${layout.minis.grid} capacity ${cols * rows}`,
    );
  }

  const workers: LayoutPaneRisk[] = [];
  for (const meta of doomedMetaForWindow(session, layout.workers.window, workerTarget)) {
    const reasons = activityReasons(loaded, meta);
    if (reasons.length) {
      workers.push({
        label: paneLabel(meta),
        paneId: meta.paneId,
        window: layout.workers.window,
        reasons,
      });
    }
  }

  const minis: LayoutPaneRisk[] = [];
  for (const meta of doomedMetaForWindow(session, layout.minis.window, miniTarget)) {
    const reasons = activityReasons(loaded, meta);
    if (reasons.length) {
      minis.push({
        label: paneLabel(meta),
        paneId: meta.paneId,
        window: layout.minis.window,
        reasons,
      });
    }
  }

  return { workers, minis };
}

export function formatRelayoutRisk(risk: LayoutRelayoutRisk): string {
  const lines: string[] = [];
  const all = [...risk.workers, ...risk.minis];
  if (!all.length) return "";
  lines.push("relayout refused: would remove panes with active work");
  for (const r of all) {
    lines.push(`  ${r.label} (${r.paneId}): ${r.reasons.join("; ")}`);
  }
  lines.push("re-run with --yes to force (kills those panes and their CLIs)");
  return lines.join("\n");
}

/** Throws when shrink would drop active workers/minis unless force=true. */
export function assertRelayoutSafe(loaded: LoadedProfile, force = false): void {
  const risk = assessRelayoutShrinkRisk(loaded);
  const blocked = risk.workers.length + risk.minis.length;
  if (!blocked) return;
  if (force) {
    console.warn(`WARN: relayout --yes — removing ${blocked} active pane(s)`);
    for (const r of [...risk.workers, ...risk.minis]) {
      console.warn(`  ${r.label} (${r.paneId}): ${r.reasons.join("; ")}`);
    }
    return;
  }
  throw new Error(formatRelayoutRisk(risk));
}

/** Summary for layout --dry-run */
export function printRelayoutPlan(loaded: LoadedProfile): void {
  const session = resolveLiveTmuxSession(loaded);
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const workerN = listWindowPaneIds(session, layout.workers.window).length;
  const miniN = listWindowPaneIds(session, layout.minis.window).length;
  const workerTarget = loaded.profile.session.workerCount;
  const miniTarget = layout.minis.max;

  console.log(
    `workers: ${workerN} -> ${workerTarget} (${workerN > workerTarget ? `remove ${workerN - workerTarget}` : "no shrink"})`,
  );
  console.log(
    `minis: ${miniN} -> ${miniTarget} (${miniN > miniTarget ? `remove ${miniN - miniTarget}` : "no shrink"})`,
  );

  const risk = assessRelayoutShrinkRisk(loaded);
  const doomedWorkers = listWindowPaneIds(session, layout.workers.window).slice(workerTarget);
  const doomedMinis = listWindowPaneIds(session, layout.minis.window).slice(miniTarget);

  if (doomedWorkers.length) {
    console.log(`would remove worker panes: ${doomedWorkers.join(", ")}`);
  }
  if (doomedMinis.length) {
    console.log(`would remove mini panes: ${doomedMinis.join(", ")}`);
  }

  const active = [...risk.workers, ...risk.minis];
  if (active.length) {
    console.log(`active (blocked without --yes): ${active.length}`);
    for (const r of active) {
      console.log(`  ${r.label}: ${r.reasons.join("; ")}`);
    }
  } else if (doomedWorkers.length || doomedMinis.length) {
    console.log("no active work detected on doomed panes");
  } else {
    console.log("no pane removal — geometry/labels only");
  }
}

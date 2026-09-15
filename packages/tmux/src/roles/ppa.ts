import { meshRuntimePaths, resolvePpaIdleSlackSec, type LoadedProfile, type ProviderRegistry } from "@seat-mesh/core";
import fs from "node:fs";
import { composerFromCapture } from "@seat-mesh/providers";
import {
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
  meshSecretaryPane,
} from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { readSeatSnapshot } from "../seats/seat-update.js";
import type { SeatTarget } from "../seats/seat-paths.js";

export interface PpaPaneState {
  label: string;
  paneId: string;
  agent: string;
  border: string;
  composer: string;
  idleS: number;
}

export interface PpaSeatRow extends PpaPaneState {
  mark: string;
  tasksOpen: number;
  slack: boolean;
  reason: string;
}

/** Default when profile omits ppa.idleSlackSec. */
export const PPA_IDLE_SLACK_SEC = 120;

function readDaemonPpaState(loaded: LoadedProfile): Map<string, PpaPaneState> {
  const file = meshRuntimePaths(loaded).ppaState;
  const out = new Map<string, PpaPaneState>();
  if (!fs.existsSync(file)) return out;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      panes?: Record<string, PpaPaneState>;
    };
    for (const row of Object.values(data.panes ?? {})) {
      out.set(row.paneId, row);
    }
  } catch {
    /* unreadable */
  }
  return out;
}

function opt(snap: { options: Record<string, string> }, key: string): string {
  return snap.options[key] ?? "";
}

function seatTargetForLabel(label: string): SeatTarget | null {
  const slot = label.match(/^slot-(\d+)$/i);
  if (slot) return { role: "worker", slot: slot[1] };
  const mini = label.match(/^mini-(\d+)$/i);
  if (mini) return { role: "manager-mini", mini: mini[1] };
  if (/^[a-z][a-z0-9-]*$/i.test(label)) return { role: label.toLowerCase() };
  return null;
}

function samplePane(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  paneId: string,
  label: string,
  daemonState: Map<string, PpaPaneState>,
): PpaPaneState {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    const prev = daemonState.get(paneId);
    return {
      label,
      paneId,
      agent: prev?.agent ?? "?",
      border: prev?.border ?? "?",
      composer: prev?.composer ?? "?",
      idleS: prev?.idleS ?? 0,
    };
  }
  const prov = registry.detect(snap);
  const agent = (prov?.id ?? snap.currentCommand) || "?";
  const composer = composerFromCapture(snap, agent);
  const composerStr = `${composer.phase}${composer.busyLabel ? `:${composer.busyLabel}` : ""}${composer.limitKind ? `:${composer.limitKind}` : ""}`;
  const border = opt(snap, "mesh_status") || composer.phase;
  const prev = daemonState.get(paneId);
  const idleS = prev?.paneId === paneId ? prev.idleS : 0;
  return { label, paneId, agent, border, composer: composerStr, idleS };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function composerBusy(composer: string): boolean {
  const phase = (composer.split(":")[0] ?? composer).toLowerCase();
  return phase === "busy" || phase === "typing" || phase === "follow-up" || phase === "limit";
}

function agentEmpty(agent: string): boolean {
  const a = agent.toLowerCase();
  return !a || a === "empty" || a === "?" || a === "zsh" || a === "bash" || a === "sh";
}

/**
 * Slack = idle long enough AND has assigned work (open TASKS or BUSY/BLOCKED mark),
 * and not currently busy in composer. Empty shells are NEVER slack.
 */
export function classifySlack(
  row: Pick<PpaPaneState, "agent" | "composer" | "idleS"> & {
    mark: string;
    tasksOpen: number;
  },
  idleThresholdSec = PPA_IDLE_SLACK_SEC,
): { slack: boolean; reason: string } {
  if (agentEmpty(row.agent)) {
    return { slack: false, reason: "empty-no-work" };
  }
  if (composerBusy(row.composer)) {
    return { slack: false, reason: "busy" };
  }
  if (row.idleS < idleThresholdSec) {
    return { slack: false, reason: `idle<${idleThresholdSec}s` };
  }
  const mark = (row.mark || "").toUpperCase();
  // OPEN alone is the default seat mark — need tasks or BUSY/BLOCKED.
  const hasWork =
    row.tasksOpen > 0 || mark === "BUSY" || mark === "BLOCKED";
  if (!hasWork) {
    return { slack: false, reason: "idle-no-tasks" };
  }
  return {
    slack: true,
    reason:
      row.tasksOpen > 0
        ? `idle=${row.idleS}s tasks=${row.tasksOpen}`
        : `idle=${row.idleS}s mark=${mark || "?"}`,
  };
}

function enrichRow(loaded: LoadedProfile, base: PpaPaneState): PpaSeatRow {
  const target = seatTargetForLabel(base.label);
  const snap = target ? readSeatSnapshot(loaded, target) : null;
  const mark = snap?.focus.mark ?? "";
  const tasksOpen = snap?.tasks.open ?? 0;
  const { slack, reason } = classifySlack({
    ...base,
    mark,
    tasksOpen,
  });
  return { ...base, mark: mark || "-", tasksOpen, slack, reason };
}

function collectRows(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
): PpaSeatRow[] {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const daemonState = readDaemonPpaState(loaded);
  const raw: PpaPaneState[] = [];

  for (const w of listMeshWorkers(session, layout.workers.window)) {
    raw.push(samplePane(loaded, registry, w.paneId, `slot-${w.slot}`, daemonState));
  }
  for (const m of listMeshMinis(session, layout.minis.window)) {
    raw.push(samplePane(loaded, registry, m.paneId, `mini-${m.mini}`, daemonState));
  }
  const mgr = meshManagerPane(session, layout.base.window);
  if (mgr) raw.push(samplePane(loaded, registry, mgr, "manager", daemonState));
  const sec = meshSecretaryPane(session, layout.base.window);
  if (sec) raw.push(samplePane(loaded, registry, sec, "secretary", daemonState));

  return raw.map((r) => enrichRow(loaded, r));
}

function printRawTable(rows: PpaSeatRow[]): void {
  const sorted = [...rows].sort((a, b) => a.label.localeCompare(b.label));
  const wAgent = Math.max(6, ...sorted.map((r) => r.agent.length));
  const wBorder = Math.max(6, ...sorted.map((r) => r.border.length));
  const wComposer = Math.max(8, ...sorted.map((r) => r.composer.length));
  console.log(
    `${pad("seat", 10)} ${pad("agent", wAgent)} ${pad("border", wBorder)} ${pad("composer", wComposer)} idle_s tasks mark`,
  );
  for (const r of sorted) {
    console.log(
      `${pad(r.label, 10)} ${pad(r.agent, wAgent)} ${pad(r.border, wBorder)} ${pad(r.composer, wComposer)} ${r.idleS} ${r.tasksOpen} ${r.mark}`,
    );
  }
}

/**
 * PPA = “are assigned agents slacking?”
 * Default: slack verdict. `--raw` / `perf-index` = telemetry table.
 */
export function runPpa(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  opts: { raw?: boolean; idleSec?: number } = {},
): void {
  const idleSec = opts.idleSec ?? resolvePpaIdleSlackSec(loaded);
  let rows = collectRows(loaded, registry).map((r) => {
    const { slack, reason } = classifySlack(r, idleSec);
    return { ...r, slack, reason };
  });

  if (opts.raw) {
    printRawTable(rows);
    return;
  }

  const slackers = rows
    .filter((r) => r.slack)
    .sort((a, b) => b.idleS - a.idleS);
  const ok = rows.filter((r) => !r.slack && !agentEmpty(r.agent));
  const empty = rows.filter((r) => agentEmpty(r.agent) && r.tasksOpen === 0);

  console.log(`--- ppa slack (idle≥${idleSec}s ∧ open work) ---`);
  if (!slackers.length) {
    console.log("slack=none");
  } else {
    console.log(`slack_n=${slackers.length}`);
    for (const r of slackers) {
      console.log(
        `slack=${r.label} idle_s=${r.idleS} tasks=${r.tasksOpen} mark=${r.mark} agent=${r.agent} composer=${r.composer} · ${r.reason}`,
      );
    }
    console.log(
      `next=peek <seat> status | peer <seat> "CONTINUE one checkbox" | remind <slot>`,
    );
  }
  if (ok.length) {
    console.log("--- ok (working / not slack) ---");
    for (const r of ok.sort((a, b) => a.label.localeCompare(b.label))) {
      console.log(
        `ok=${r.label} idle_s=${r.idleS} tasks=${r.tasksOpen} mark=${r.mark} composer=${r.composer}`,
      );
    }
  }
  if (empty.length) {
    console.log(`empty_shells=${empty.length} (no tasks — not counted as slack)`);
  }
  console.log("raw=seatmesh agent ppa --raw   # full telemetry table");
}

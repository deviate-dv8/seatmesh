import { meshRuntimePaths, type LoadedProfile, type ProviderRegistry } from "@seat-mesh/core";
import fs from "node:fs";
import path from "node:path";
import { composerFromCapture } from "@seat-mesh/providers";
import {
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
  meshSecretaryPane,
} from "../lib/pane-meta.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";

interface PpaPaneState {
  label: string;
  paneId: string;
  agent: string;
  border: string;
  composer: string;
  idleS: number;
}

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

/** Performance index — sample all seats + minis (agent | border | composer | idle_s). */
export function runPpa(loaded: LoadedProfile, registry: ProviderRegistry): void {
  const session = loaded.sessionName;
  const layout = loaded.profile.layout;
  if (!layout) throw new Error("profile missing layout");

  const daemonState = readDaemonPpaState(loaded);
  const rows: PpaPaneState[] = [];

  for (const w of listMeshWorkers(session, layout.workers.window)) {
    rows.push(
      samplePane(loaded, registry, w.paneId, `slot-${w.slot}`, daemonState),
    );
  }
  for (const m of listMeshMinis(session, layout.minis.window)) {
    rows.push(
      samplePane(loaded, registry, m.paneId, `mini-${m.mini}`, daemonState),
    );
  }
  const mgr = meshManagerPane(session, layout.base.window);
  if (mgr) rows.push(samplePane(loaded, registry, mgr, "manager", daemonState));
  const sec = meshSecretaryPane(session, layout.base.window);
  if (sec) rows.push(samplePane(loaded, registry, sec, "secretary", daemonState));

  rows.sort((a, b) => a.label.localeCompare(b.label));

  const wAgent = Math.max(6, ...rows.map((r) => r.agent.length));
  const wBorder = Math.max(6, ...rows.map((r) => r.border.length));
  const wComposer = Math.max(8, ...rows.map((r) => r.composer.length));

  console.log(
    `${pad("seat", 10)} ${pad("agent", wAgent)} ${pad("border", wBorder)} ${pad("composer", wComposer)} idle_s`,
  );
  for (const r of rows) {
    console.log(
      `${pad(r.label, 10)} ${pad(r.agent, wAgent)} ${pad(r.border, wBorder)} ${pad(r.composer, wComposer)} ${r.idleS}`,
    );
  }
}

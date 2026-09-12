import { spawnSync } from "node:child_process";
import type { ComposerState, LoadedProfile, ProviderRegistry, ResolvedUxConfig } from "@seat-mesh/core";
import { evaluateUxRules, resolveUxConfig } from "@seat-mesh/core";
import {
  capturePaneSnapshot,
  listMeshMinis,
  listMeshWorkers,
  meshManagerPane,
  meshSecretaryPane,
} from "@seat-mesh/tmux";
import { classifyCoordDelivery } from "./compose-gate.js";
import type { QueueStore } from "./create-queue-store.js";
import { PpaStateStore } from "./ppa-state.js";

let ppaStore: PpaStateStore | null = null;

function ppaForStateDir(stateDir: string): PpaStateStore {
  if (!ppaStore) ppaStore = new PpaStateStore(stateDir);
  return ppaStore;
}

function tmuxSet(paneId: string, key: string, value: string): void {
  spawnSync("tmux", ["set-option", "-p", "-t", paneId, key, value], { encoding: "utf8" });
}

const BORDER_PAINT_BATCH = 6;
let borderPaintOffset = 0;

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function phaseLabel(phase: string, busyLabel?: string, limitKind?: string): string {
  if (phase === "busy") return busyLabel ?? "BUSY";
  if (phase === "limit") return limitKind ?? "LIMIT";
  if (phase === "typing") return "typing";
  if (phase === "afk") return "AFK";
  if (phase === "plain_shell") return "empty";
  return "idle";
}

export interface BorderPaintConnectivity {
  proxyDownActive: boolean;
  ocLimitedPaneIds: Set<string>;
}

function borderFromState(
  st: ComposerState,
  ux: ResolvedUxConfig | null | undefined,
  snap: NonNullable<ReturnType<typeof capturePaneSnapshot>>,
  provId: string,
): string {
  if (st.phase === "limit") {
    if (ux) {
      const uxHit = evaluateUxRules(snap, provId, ux);
      if (uxHit?.border) return uxHit.border;
    }
    if (st.limitKind === "oc-connect") return "PROXY-DOWN";
    return `OC-LIMIT:${st.limitKind ?? "limit"}`;
  }
  if (ux) {
    const uxHit = evaluateUxRules(snap, provId, ux);
    if (uxHit?.border) return uxHit.border;
  }
  return phaseLabel(st.phase, st.busyLabel, st.limitKind);
}

function paintOnePaneBorder(
  registry: ProviderRegistry,
  store: QueueStore,
  paneId: string,
  connectivity: BorderPaintConnectivity | undefined,
  inheritGlobal: boolean,
  label: string,
  ppa: PpaStateStore | null,
  activeCb: number,
  ux: ResolvedUxConfig | null | undefined,
): void {
  const snap = capturePaneSnapshot(paneId);
  if (!snap) return;
  const prov = registry.detect(snap);
  if (!prov) {
    tmuxSet(paneId, "@mesh_status", "empty");
    return;
  }
  const st = prov.composerState(snap);
  let borderStatus = borderFromState(st, ux, snap, prov.id);
  if (
    st.phase !== "limit" &&
    inheritGlobal &&
    connectivity &&
    (connectivity.proxyDownActive || connectivity.ocLimitedPaneIds.size > 0)
  ) {
    borderStatus = connectivity.proxyDownActive ? "PROXY-DOWN" : "OC-LIMIT:oc-limit";
  }
  tmuxSet(paneId, "@mesh_status", borderStatus);
  if (ppa && label) {
    ppa.touch({
      paneId,
      label,
      agent: prov.id,
      border: borderStatus,
      composerPhase: st.phase,
      composerLabel: st.busyLabel ?? st.limitKind ?? "",
    });
  }
  const ownerCb = store
    .readCheckbacks()
    .filter((r) => r.status === "active" && r.ownerPane === paneId).length;
  if (ownerCb > 0) {
    tmuxSet(paneId, "@mesh_patience", `PS:${ownerCb}`);
  } else if (activeCb > 0) {
    tmuxSet(paneId, "@mesh_patience", `PO:${activeCb}`);
  } else {
    tmuxSet(paneId, "@mesh_patience", "");
  }
}

/** Immediate border refresh for one pane (e.g. after resume ack clears OC-LIMIT). */
export function repaintMeshPaneBorder(
  registry: ProviderRegistry,
  store: QueueStore,
  paneId: string,
  connectivity?: BorderPaintConnectivity,
  inheritGlobal = false,
  label = "",
  stateDir?: string,
  ux?: ResolvedUxConfig | null,
): void {
  const ppa = stateDir ? ppaForStateDir(stateDir) : null;
  const activeCb = store.readCheckbacks().filter((r) => r.status === "active").length;
  paintOnePaneBorder(registry, store, paneId, connectivity, inheritGlobal, label, ppa, activeCb, ux);
}

/** Paint @mesh_status (+ optional @mesh_patience) on live panes. */
export function paintMeshBorders(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  store: QueueStore,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  skipPaneIds: Set<string> = new Set(),
  connectivity?: BorderPaintConnectivity,
  stateDir?: string,
): void {
  const ux =
    loaded.profile.ux !== undefined ? resolveUxConfig(loaded.profile.ux) : null;
  const ppa = stateDir ? ppaForStateDir(stateDir) : null;
  const activeCb = store.readCheckbacks().filter((r) => r.status === "active").length;
  const unresolved = store.readInbox().filter((r) => !r.resolved).length;
  const unsent = store
    .readInbox()
    .filter((r) => !r.resolved && !(r.sent && r.sentAt && r.deliverPane)).length;

  const paintOne = (
    paneId: string,
    _defaultPorts: string,
    inheritGlobal = false,
    label = "",
  ) => {
    if (skipPaneIds.has(paneId)) return;
    paintOnePaneBorder(
      registry,
      store,
      paneId,
      connectivity,
      inheritGlobal,
      label,
      ppa,
      activeCb,
      ux,
    );
  };

  const targets: { paneId: string; ports: string; label: string }[] = [
    ...listMeshWorkers(session, workersWindow).map((w) => ({
      paneId: w.paneId,
      ports: w.ports,
      label: `slot-${w.slot}`,
    })),
    ...listMeshMinis(session, minisWindow).map((m) => ({
      paneId: m.paneId,
      ports: m.ports,
      label: `mini-${m.mini}`,
    })),
  ];
  if (targets.length) {
    const batch = Math.min(BORDER_PAINT_BATCH, targets.length);
    for (let i = 0; i < batch; i++) {
      const t = targets[(borderPaintOffset + i) % targets.length]!;
      paintOne(t.paneId, t.ports, false, t.label);
    }
    borderPaintOffset = (borderPaintOffset + batch) % targets.length;
  }

  const paintCoordInboxOrComposer = (
    paneId: string,
    ports: string,
    label: string,
    inheritGlobal: boolean,
  ) => {
    if (unsent > 0) {
      const snap = capturePaneSnapshot(paneId);
      const prov = snap ? registry.detect(snap) : null;
      const st = prov && snap ? prov.composerState(snap) : null;
      const gate =
        prov && snap && st
          ? classifyCoordDelivery(paneId, st, snap.captureTail, prov.id)
          : null;
      let suffix = "pending";
      if (gate?.phase === "wait-typing") suffix = "wait typing";
      else if (gate?.phase === "wait-busy") suffix = "wait generate";
      else if (gate?.phase === "wait-settle" && gate.settleInSec != null) {
        suffix = `settle ${gate.settleInSec}s`;
      }
      tmuxSet(paneId, "@mesh_status", `INBOX · ${unsent} · ${suffix}`);
      return;
    }
    if (unresolved > 0) {
      tmuxSet(paneId, "@mesh_status", `INBOX · ${unresolved} unresolved`);
      return;
    }
    paintOne(paneId, ports, inheritGlobal, label);
  };

  const mgr = meshManagerPane(session, baseWindow);
  if (mgr) {
    paintCoordInboxOrComposer(mgr, "manager", "manager", false);
  }

  const sec = meshSecretaryPane(session, baseWindow);
  if (sec) {
    paintOne(sec, "secretary", true, "secretary");
  }
}

/** Yield between panes so GET /health can answer mid-paint. */
export async function paintMeshBordersAsync(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  store: QueueStore,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
  skipPaneIds: Set<string> = new Set(),
  connectivity?: BorderPaintConnectivity,
  stateDir?: string,
): Promise<void> {
  const ux =
    loaded.profile.ux !== undefined ? resolveUxConfig(loaded.profile.ux) : null;
  const ppa = stateDir ? ppaForStateDir(stateDir) : null;
  const activeCb = store.readCheckbacks().filter((r) => r.status === "active").length;
  const unresolved = store.readInbox().filter((r) => !r.resolved).length;
  const unsent = store
    .readInbox()
    .filter((r) => !r.resolved && !(r.sent && r.sentAt && r.deliverPane)).length;

  const paintOne = (
    paneId: string,
    _defaultPorts: string,
    inheritGlobal = false,
    label = "",
  ) => {
    if (skipPaneIds.has(paneId)) return;
    paintOnePaneBorder(
      registry,
      store,
      paneId,
      connectivity,
      inheritGlobal,
      label,
      ppa,
      activeCb,
      ux,
    );
  };

  const targets: { paneId: string; ports: string; label: string }[] = [
    ...listMeshWorkers(session, workersWindow).map((w) => ({
      paneId: w.paneId,
      ports: w.ports,
      label: `slot-${w.slot}`,
    })),
    ...listMeshMinis(session, minisWindow).map((m) => ({
      paneId: m.paneId,
      ports: m.ports,
      label: `mini-${m.mini}`,
    })),
  ];
  if (targets.length) {
    const batch = Math.min(BORDER_PAINT_BATCH, targets.length);
    for (let i = 0; i < batch; i++) {
      if (i > 0) await yieldEventLoop();
      const t = targets[(borderPaintOffset + i) % targets.length]!;
      paintOne(t.paneId, t.ports, false, t.label);
    }
    borderPaintOffset = (borderPaintOffset + batch) % targets.length;
  }

  const paintCoordInboxOrComposer = async (
    paneId: string,
    ports: string,
    label: string,
    inheritGlobal: boolean,
  ) => {
    if (unsent > 0) {
      const snap = capturePaneSnapshot(paneId);
      const prov = snap ? registry.detect(snap) : null;
      const st = prov && snap ? prov.composerState(snap) : null;
      const gate =
        prov && snap && st
          ? classifyCoordDelivery(paneId, st, snap.captureTail, prov.id)
          : null;
      let suffix = "pending";
      if (gate?.phase === "wait-typing") suffix = "wait typing";
      else if (gate?.phase === "wait-busy") suffix = "wait generate";
      else if (gate?.phase === "wait-settle" && gate.settleInSec != null) {
        suffix = `settle ${gate.settleInSec}s`;
      }
      tmuxSet(paneId, "@mesh_status", `INBOX · ${unsent} · ${suffix}`);
      return;
    }
    if (unresolved > 0) {
      tmuxSet(paneId, "@mesh_status", `INBOX · ${unresolved} unresolved`);
      return;
    }
    paintOne(paneId, ports, inheritGlobal, label);
  };

  await yieldEventLoop();
  const mgr = meshManagerPane(session, baseWindow);
  if (mgr) {
    await paintCoordInboxOrComposer(mgr, "manager", "manager", false);
  }

  await yieldEventLoop();
  const sec = meshSecretaryPane(session, baseWindow);
  if (sec) {
    paintOne(sec, "secretary", true, "secretary");
  }
}

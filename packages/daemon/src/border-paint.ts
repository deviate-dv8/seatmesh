import { spawnSync } from "node:child_process";
import type { ComposerState, LoadedProfile, ProviderRegistry, ResolvedUxConfig } from "@seat-mesh/core";
import {
  baseColumnIds,
  evaluateUxRules,
  isManagerKind,
  isSecretaryKind,
  resolveUxConfig,
} from "@seat-mesh/core";
import {
  applyMeshSessionBorders,
  bannerNameFromMeta,
  capturePaneSnapshot,
  coordPaneForRole,
  formatBannerCheckbacks,
  formatBannerInbox,
  formatBannerTasks,
  listMeshMinis,
  listMeshWorkers,
  paneMetaForPane,
  readSeatSnapshot,
} from "@seat-mesh/tmux";
import { classifyCoordDelivery } from "./compose-gate.js";
import type { QueueStore } from "./create-queue-store.js";
import { isInboxDelivered } from "./create-queue-store.js";
import { countPeerPendingForPane, countPeerPendingGlobal } from "./peer-pending.js";
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
    if (st.limitKind === "cc-limit") return "CC-LIMIT";
    return `OC-LIMIT:${st.limitKind ?? "limit"}`;
  }
  if (ux) {
    const uxHit = evaluateUxRules(snap, provId, ux);
    if (uxHit?.border) return uxHit.border;
  }
  return phaseLabel(st.phase, st.busyLabel, st.limitKind);
}

function inboxWaitSuffix(
  paneId: string,
  registry: ProviderRegistry,
  unsent: number,
): string | undefined {
  if (unsent <= 0) return undefined;
  const snap = capturePaneSnapshot(paneId);
  const prov = snap ? registry.detect(snap) : null;
  const st = prov && snap ? prov.composerState(snap) : null;
  if (!prov || !snap || !st) return "pending";
  const gate = classifyCoordDelivery(paneId, st, snap.captureTail, prov.id);
  if (gate.phase === "wait-typing") return "wait";
  if (gate.phase === "wait-busy") return "wait";
  if (gate.phase === "wait-settle") return "settle";
  return "pending";
}

function paintOnePaneBorder(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  store: QueueStore,
  paneId: string,
  connectivity: BorderPaintConnectivity | undefined,
  inheritGlobal: boolean,
  label: string,
  ppa: PpaStateStore | null,
  counts: { unsent: number; unresolved: number },
  ux: ResolvedUxConfig | null | undefined,
  coordInbox: boolean,
): void {
  const meta = paneMetaForPane(paneId);
  const name = bannerNameFromMeta(meta, label);
  tmuxSet(paneId, "@mesh_name", name);

  const seat = readSeatSnapshot(loaded, {
    role: meta?.role || label,
    slot: meta?.slot || null,
    mini: meta?.mini || null,
  });
  tmuxSet(paneId, "@mesh_tasks", formatBannerTasks(seat?.tasks.open ?? 0));

  let inboxN = countPeerPendingForPane(store, paneId);
  let wait: string | undefined;
  if (coordInbox) {
    inboxN += counts.unsent + (counts.unsent === 0 ? counts.unresolved : 0);
    wait = inboxWaitSuffix(paneId, registry, counts.unsent);
  }
  const ownerCb = store
    .readCheckbacks()
    .filter((r) => r.status === "active" && r.ownerPane === paneId).length;
  tmuxSet(paneId, "@mesh_inbox", formatBannerInbox(inboxN, wait, ownerCb));
  tmuxSet(paneId, "@mesh_checkbacks", formatBannerCheckbacks(ownerCb));
  tmuxSet(paneId, "@mesh_patience", ownerCb > 0 ? `PS:${ownerCb}` : "");

  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    tmuxSet(paneId, "@mesh_status", "empty");
    return;
  }
  const prov = registry.detect(snap);
  if (!prov) {
    tmuxSet(paneId, "@mesh_status", "empty");
    return;
  }
  const st = prov.composerState(snap);
  let borderStatus = borderFromState(st, ux, snap, prov.id);
  if (st.phase !== "limit" && inheritGlobal && connectivity) {
    // Global PROXY-DOWN is an OpenCode/CPE episode — do not paint it on Claude/agent/coord panes.
    if (connectivity.proxyDownActive && prov.id === "opencode") {
      borderStatus = "PROXY-DOWN";
    } else if (connectivity.ocLimitedPaneIds.has(paneId)) {
      borderStatus = "OC-LIMIT:oc-limit";
    }
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
}

function sessionWindows(
  loaded: LoadedProfile,
  session: string,
  baseWindow: string,
  workersWindow: string,
  minisWindow: string,
): string[] {
  const wins = [baseWindow, workersWindow, minisWindow];
  const nvim = loaded.profile.layout?.nvim?.window;
  if (nvim) wins.push(nvim);
  applyMeshSessionBorders(session, [...new Set(wins.filter(Boolean))]);
  return wins;
}

function paintCounts(store: QueueStore): { unsent: number; unresolved: number } {
  const inbox = store.readInbox();
  const unresolved = inbox.filter((r) => !r.resolved).length;
  const unsent = inbox.filter((r) => !r.resolved && !isInboxDelivered(r)).length;
  return { unsent, unresolved };
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
  loaded?: LoadedProfile,
): void {
  const ppa = stateDir ? ppaForStateDir(stateDir) : null;
  const counts = paintCounts(store);
  if (!loaded) {
    tmuxSet(paneId, "@mesh_status", "idle");
    return;
  }
  paintOnePaneBorder(
    loaded,
    registry,
    store,
    paneId,
    connectivity,
    inheritGlobal,
    label,
    ppa,
    counts,
    ux,
    isManagerKind(label),
  );
}

function collectWorkerMiniTargets(
  session: string,
  workersWindow: string,
  minisWindow: string,
): { paneId: string; label: string }[] {
  return [
    ...listMeshWorkers(session, workersWindow).map((w) => ({
      paneId: w.paneId,
      label: `slot-${w.slot}`,
    })),
    ...listMeshMinis(session, minisWindow).map((m) => ({
      paneId: m.paneId,
      label: `mini-${m.mini}`,
    })),
  ];
}

/** Paint name | tasks | inbox | checkbacks | status. Inbox never stomps status. */
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
  const counts = paintCounts(store);
  sessionWindows(loaded, session, baseWindow, workersWindow, minisWindow);

  const paintOne = (paneId: string, inheritGlobal = false, label = "", coordInbox = false) => {
    if (skipPaneIds.has(paneId)) return;
    paintOnePaneBorder(
      loaded,
      registry,
      store,
      paneId,
      connectivity,
      inheritGlobal,
      label,
      ppa,
      counts,
      ux,
      coordInbox,
    );
  };

  const targets = collectWorkerMiniTargets(session, workersWindow, minisWindow);
  if (targets.length) {
    const batch = workerMiniPaintBatch(targets.length, store);
    for (let i = 0; i < batch; i++) {
      const t = targets[(borderPaintOffset + i) % targets.length]!;
      paintOne(t.paneId, false, t.label, false);
    }
    borderPaintOffset = (borderPaintOffset + batch) % targets.length;
  }

  for (const col of baseColumnIds(loaded.profile.layout)) {
    const pane = coordPaneForRole(session, baseWindow, col);
    if (!pane) continue;
    const kinds = loaded.profile.layout?.base.kinds;
    paintOne(pane, isSecretaryKind(col, kinds), col, isManagerKind(col, kinds));
  }
}

/** When no live peer queue, refresh every worker/mini banner (clear stale backlog counts). */
function workerMiniPaintBatch(targetLen: number, store: QueueStore): number {
  if (targetLen <= 0) return 0;
  if (countPeerPendingGlobal(store) === 0) return targetLen;
  return Math.min(BORDER_PAINT_BATCH, targetLen);
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
  const counts = paintCounts(store);
  sessionWindows(loaded, session, baseWindow, workersWindow, minisWindow);

  const paintOne = (paneId: string, inheritGlobal = false, label = "", coordInbox = false) => {
    if (skipPaneIds.has(paneId)) return;
    paintOnePaneBorder(
      loaded,
      registry,
      store,
      paneId,
      connectivity,
      inheritGlobal,
      label,
      ppa,
      counts,
      ux,
      coordInbox,
    );
  };

  const targets = collectWorkerMiniTargets(session, workersWindow, minisWindow);
  if (targets.length) {
    const batch = workerMiniPaintBatch(targets.length, store);
    for (let i = 0; i < batch; i++) {
      if (i > 0) await yieldEventLoop();
      const t = targets[(borderPaintOffset + i) % targets.length]!;
      paintOne(t.paneId, false, t.label, false);
    }
    borderPaintOffset = (borderPaintOffset + batch) % targets.length;
  }

  for (const col of baseColumnIds(loaded.profile.layout)) {
    await yieldEventLoop();
    const pane = coordPaneForRole(session, baseWindow, col);
    if (!pane) continue;
    const kinds = loaded.profile.layout?.base.kinds;
    paintOne(pane, isSecretaryKind(col, kinds), col, isManagerKind(col, kinds));
  }
}

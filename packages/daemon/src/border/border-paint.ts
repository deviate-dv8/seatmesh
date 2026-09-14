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
  bannerNameFromMeta,
  capturePaneSnapshot,
  coordPaneForRole,
  fitBannerLine,
  formatBannerCheckbacks,
  formatBannerInbox,
  formatBannerTasks,
  listMeshMinis,
  listMeshWorkers,
  paneDisplayWidth,
  paneMetaForPane,
  readSeatSnapshot,
} from "@seat-mesh/tmux";
import { classifyCoordDelivery } from "../inject/compose-gate.js";
import type { QueueStore } from "../store/create-queue-store.js";
import { isInboxDelivered } from "../store/create-queue-store.js";
import { isPeerPendingDelivery } from "../peer/peer-pending.js";
import { PpaStateStore } from "../state/ppa-state.js";
import { observePaneComposer } from "../ack/ack-watch.js";
import { coordComposerDraft } from "@seat-mesh/providers";
import {
  formatBannerAck,
  isAckStale,
  openAcks,
} from "@seat-mesh/core";

let ppaStore: PpaStateStore | null = null;

function ppaForStateDir(stateDir: string): PpaStateStore {
  if (!ppaStore) ppaStore = new PpaStateStore(stateDir);
  return ppaStore;
}

function tmuxSet(paneId: string, key: string, value: string): void {
  spawnSync("tmux", ["set-option", "-p", "-t", paneId, key, value], { encoding: "utf8" });
}

/** Small meshes: paint every worker/mini each drain tick (cheap). */
export const FULL_BANNER_PAINT_EVERY_TICK = 10;
/** Large mesh + live peer queue: rotate non-priority panes — cap tmux/capture load. */
const BORDER_PAINT_BATCH = 6;
let borderPaintOffset = 0;

export interface WorkerMiniPaintTarget {
  paneId: string;
  label: string;
}

interface BorderPaintMaps {
  counts: { unsent: number; unresolved: number };
  peerPendingByPane: Map<string, number>;
  checkbacksByPane: Map<string, number>;
  openAcksByPane: Map<string, number>;
  staleAcksByPane: Map<string, number>;
}

function buildBorderPaintMaps(store: QueueStore): BorderPaintMaps {
  const peerPendingByPane = new Map<string, number>();
  for (const row of store.readPeer()) {
    if (!isPeerPendingDelivery(row) || !row.targetPane) continue;
    peerPendingByPane.set(
      row.targetPane,
      (peerPendingByPane.get(row.targetPane) ?? 0) + 1,
    );
  }
  const checkbacksByPane = new Map<string, number>();
  for (const row of store.readCheckbacks()) {
    if (row.status !== "active" || !row.ownerPane) continue;
    checkbacksByPane.set(
      row.ownerPane,
      (checkbacksByPane.get(row.ownerPane) ?? 0) + 1,
    );
  }
  const openAcksByPane = new Map<string, number>();
  const staleAcksByPane = new Map<string, number>();
  for (const row of openAcks(store.readAcks())) {
    if (!row.paneId) continue;
    openAcksByPane.set(row.paneId, (openAcksByPane.get(row.paneId) ?? 0) + 1);
    if (isAckStale(row)) {
      staleAcksByPane.set(row.paneId, (staleAcksByPane.get(row.paneId) ?? 0) + 1);
    }
  }
  return { counts: paintCounts(store), peerPendingByPane, checkbacksByPane, openAcksByPane, staleAcksByPane };
}

/**
 * Coordinator panes paint every tick; worker/mini batch only on large meshes with
 * live peer queue. Priority panes (pending mail) always included.
 */
export function selectWorkerMiniPaintTargets(
  targets: WorkerMiniPaintTarget[],
  peerPendingByPane: Map<string, number>,
  offset: number,
  batchCap: number,
): { selected: WorkerMiniPaintTarget[]; nextOffset: number } {
  if (!targets.length) return { selected: [], nextOffset: 0 };
  if (targets.length <= FULL_BANNER_PAINT_EVERY_TICK || peerPendingByPane.size === 0) {
    return { selected: targets, nextOffset: 0 };
  }

  const priority = targets.filter((t) => (peerPendingByPane.get(t.paneId) ?? 0) > 0);
  const rest = targets.filter((t) => (peerPendingByPane.get(t.paneId) ?? 0) === 0);
  const selected: WorkerMiniPaintTarget[] = [];
  const seen = new Set<string>();
  const add = (t: WorkerMiniPaintTarget) => {
    if (seen.has(t.paneId)) return;
    seen.add(t.paneId);
    selected.push(t);
  };

  for (const t of priority) {
    if (selected.length >= batchCap) break;
    add(t);
  }
  const room = batchCap - selected.length;
  for (let i = 0; i < room && rest.length > 0; i++) {
    add(rest[(offset + i) % rest.length]!);
  }
  const nextOffset = rest.length > 0 ? (offset + room) % rest.length : 0;
  return { selected, nextOffset };
}

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

/** Limit / proxy borders — must not flicker to idle on a blank capture redraw. */
const STICKY_NEGATIVE_RE = /^(CC-LIMIT|PROXY-DOWN|OC-LIMIT:|LIMIT\b)/i;

interface StickyNeg {
  status: string;
  clearVotes: number;
}

const stickyNegativeByPane = new Map<string, StickyNeg>();

/** How many consecutive healthy paints before a sticky limit/proxy clears. */
const STICKY_CLEAR_VOTES = 2;

function isStickyNegativeStatus(status: string): boolean {
  return STICKY_NEGATIVE_RE.test(status.trim());
}

/**
 * Keep CC-LIMIT / OC-LIMIT / PROXY-DOWN until the composer proves healthy twice.
 * Blank redraws and missed limit text must not snap the border back to idle.
 */
export function applyStickyNegativeStatus(
  paneId: string,
  candidate: string,
  st: ComposerState | null,
): string {
  const prev = stickyNegativeByPane.get(paneId);
  if (isStickyNegativeStatus(candidate)) {
    stickyNegativeByPane.set(paneId, { status: candidate, clearVotes: 0 });
    return candidate;
  }
  if (!prev) return candidate;

  // Still in limit phase — keep sticky even if borderFromState misfired.
  if (st?.phase === "limit") {
    stickyNegativeByPane.set(paneId, { status: prev.status, clearVotes: 0 });
    return prev.status;
  }

  // Live positive activity may clear after votes; idle/empty alone is not enough
  // on the first miss (that is the flicker we are killing).
  const healthy =
    st != null &&
    (st.phase === "busy" ||
      st.phase === "typing" ||
      st.phase === "afk" ||
      (st.phase === "empty" && candidate !== "idle" && candidate !== "empty"));

  if (healthy || (st?.phase === "empty" && candidate === "empty")) {
    const votes = prev.clearVotes + 1;
    if (votes >= STICKY_CLEAR_VOTES) {
      stickyNegativeByPane.delete(paneId);
      return candidate;
    }
    stickyNegativeByPane.set(paneId, { status: prev.status, clearVotes: votes });
    return prev.status;
  }

  // idle / plain_shell / missing state — hold sticky
  stickyNegativeByPane.set(paneId, { status: prev.status, clearVotes: 0 });
  return prev.status;
}

/** Tests / inbox restart. */
export function resetStickyNegativeStatus(paneId?: string): void {
  if (paneId) stickyNegativeByPane.delete(paneId);
  else stickyNegativeByPane.clear();
}

export interface BorderPaintConnectivity {
  proxyDownActive: boolean;
  ocLimitedPaneIds: Set<string>;
  /** Panes with debounce-confirmed oc-connect (not stale scrollback one-shots). */
  connectPaneIds: Set<string>;
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
    if (st.limitKind === "oc-connect") return "CONNECT";
    if (st.limitKind === "cc-limit") return "CC-LIMIT";
    return `OC-LIMIT:${st.limitKind ?? "limit"}`;
  }
  if (ux) {
    const uxHit = evaluateUxRules(snap, provId, ux);
    if (uxHit?.border) return uxHit.border;
  }
  return phaseLabel(st.phase, st.busyLabel, st.limitKind);
}

function paintOnePaneBorder(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  paneId: string,
  connectivity: BorderPaintConnectivity | undefined,
  inheritGlobal: boolean,
  label: string,
  ppa: PpaStateStore | null,
  maps: BorderPaintMaps,
  ux: ResolvedUxConfig | null | undefined,
  coordInbox: boolean,
): void {
  const { counts, peerPendingByPane, checkbacksByPane, openAcksByPane, staleAcksByPane } = maps;
  const meta = paneMetaForPane(paneId);
  const name = bannerNameFromMeta(meta, label);
  tmuxSet(paneId, "@mesh_name", name);

  const seat = readSeatSnapshot(loaded, {
    role: meta?.role || label,
    slot: meta?.slot || null,
    mini: meta?.mini || null,
  });
  const tasks = formatBannerTasks(seat?.tasks.open ?? 0);
  tmuxSet(paneId, "@mesh_tasks", tasks);

  let inboxN = peerPendingByPane.get(paneId) ?? 0;
  let wait: string | undefined;

  const snap = capturePaneSnapshot(paneId);
  let borderStatus = "empty";
  let prov: ReturnType<ProviderRegistry["detect"]> = null;
  let st: ComposerState | null = null;
  if (snap) {
    prov = registry.detect(snap);
    if (prov) {
      st = prov.composerState(snap);
      borderStatus = borderFromState(st, ux, snap, prov.id);
      if (st.phase !== "limit" && inheritGlobal && connectivity) {
        // Global PROXY-DOWN is an OpenCode/CPE episode — do not paint it on Claude/agent/coord panes.
        // Also skip overlay when this OC pane is live (busy/typing): tokens flowing means the
        // connect blip recovered; overlay would re-arm sticky PROXY-DOWN every paint.
        if (
          connectivity.connectPaneIds.has(paneId) &&
          prov.id === "opencode" &&
          st.phase !== "busy" &&
          st.phase !== "typing"
        ) {
          borderStatus = "PROXY-DOWN";
        } else if (
          connectivity.proxyDownActive &&
          prov.id === "opencode" &&
          st.phase !== "busy" &&
          st.phase !== "typing"
        ) {
          borderStatus = "PROXY-DOWN";
        } else if (connectivity.ocLimitedPaneIds.has(paneId) && st.phase !== "busy" && st.phase !== "typing") {
          borderStatus = "OC-LIMIT:oc-limit";
        }
      }
      // Composer watch for operator-prompt ACK opens (same capture as banner).
      if (label && meta?.role && meta.role !== "plain") {
        const draft =
          st.draftFingerprint?.trim() ||
          coordComposerDraft(snap.captureTail, prov.id, snap.captureTailAnsi) ||
          "";
        observePaneComposer(paneId, label, draft, snap.captureTail);
      }
    }
  }

  borderStatus = applyStickyNegativeStatus(paneId, borderStatus, st);

  if (coordInbox) {
    inboxN += counts.unsent + (counts.unsent === 0 ? counts.unresolved : 0);
    if (counts.unsent > 0 && st && prov && snap) {
      const gate = classifyCoordDelivery(paneId, st, snap.captureTail, prov.id);
      if (gate.phase === "wait-typing") wait = "wait";
      else if (gate.phase === "wait-busy") wait = "wait";
      else if (gate.phase === "wait-settle") wait = "settle";
      else wait = "pending";
    } else if (counts.unsent > 0) {
      wait = "pending";
    }
  }
  const ownerCb = checkbacksByPane.get(paneId) ?? 0;
  const inbox = formatBannerInbox(inboxN, wait, ownerCb);
  tmuxSet(paneId, "@mesh_inbox", inbox);
  tmuxSet(paneId, "@mesh_checkbacks", formatBannerCheckbacks(ownerCb));
  tmuxSet(paneId, "@mesh_patience", ownerCb > 0 ? `PS:${ownerCb}` : "");
  const ackOpen = openAcksByPane.get(paneId) ?? 0;
  const ackStale = staleAcksByPane.get(paneId) ?? 0;
  const ack = formatBannerAck(ackOpen, ackStale);
  tmuxSet(paneId, "@mesh_ack", ack);

  tmuxSet(paneId, "@mesh_status", borderStatus);
  tmuxSet(
    paneId,
    "@mesh_banner",
    fitBannerLine(paneDisplayWidth(paneId), {
      name,
      tasks,
      inbox,
      ack: ackOpen > 0 ? ack : "",
      status: borderStatus,
    }),
  );
  if (!snap || !prov || !st) return;
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
  if (!loaded) {
    // Never wipe a sticky limit/proxy to idle on a partial repaint.
    const held = stickyNegativeByPane.get(paneId)?.status;
    tmuxSet(paneId, "@mesh_status", held ?? "idle");
    return;
  }
  paintOnePaneBorder(
    loaded,
    registry,
    paneId,
    connectivity,
    inheritGlobal,
    label,
    ppa,
    buildBorderPaintMaps(store),
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
  const maps = buildBorderPaintMaps(store);

  const paintOne = (paneId: string, inheritGlobal = false, label = "", coordInbox = false) => {
    if (skipPaneIds.has(paneId)) return;
    paintOnePaneBorder(
      loaded,
      registry,
      paneId,
      connectivity,
      inheritGlobal,
      label,
      ppa,
      maps,
      ux,
      coordInbox,
    );
  };

  const targets = collectWorkerMiniTargets(session, workersWindow, minisWindow);
  if (targets.length) {
    const { selected, nextOffset } = selectWorkerMiniPaintTargets(
      targets,
      maps.peerPendingByPane,
      borderPaintOffset,
      BORDER_PAINT_BATCH,
    );
    for (const t of selected) {
      paintOne(t.paneId, false, t.label, false);
    }
    borderPaintOffset = nextOffset;
  }

  for (const col of baseColumnIds(loaded.profile.layout)) {
    const pane = coordPaneForRole(session, baseWindow, col);
    if (!pane) continue;
    const kinds = loaded.profile.layout?.base.kinds;
    paintOne(pane, isSecretaryKind(col, kinds), col, isManagerKind(col, kinds));
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
  const maps = buildBorderPaintMaps(store);

  const paintOne = (paneId: string, inheritGlobal = false, label = "", coordInbox = false) => {
    if (skipPaneIds.has(paneId)) return;
    paintOnePaneBorder(
      loaded,
      registry,
      paneId,
      connectivity,
      inheritGlobal,
      label,
      ppa,
      maps,
      ux,
      coordInbox,
    );
  };

  const targets = collectWorkerMiniTargets(session, workersWindow, minisWindow);
  if (targets.length) {
    const { selected, nextOffset } = selectWorkerMiniPaintTargets(
      targets,
      maps.peerPendingByPane,
      borderPaintOffset,
      BORDER_PAINT_BATCH,
    );
    for (let i = 0; i < selected.length; i++) {
      if (i > 0) await yieldEventLoop();
      const t = selected[i]!;
      paintOne(t.paneId, false, t.label, false);
    }
    borderPaintOffset = nextOffset;
  }

  for (const col of baseColumnIds(loaded.profile.layout)) {
    await yieldEventLoop();
    const pane = coordPaneForRole(session, baseWindow, col);
    if (!pane) continue;
    const kinds = loaded.profile.layout?.base.kinds;
    paintOne(pane, isSecretaryKind(col, kinds), col, isManagerKind(col, kinds));
  }
}

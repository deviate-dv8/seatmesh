import type { LoadedProfile, ProviderRegistry } from "seat-mesh-core";
import {
  formatCompactSeat,
  formatGenericCheckback,
  formatRoomCallCheckback,
  formatRoomCommsCheckback,
  isRoomCallExpect,
} from "seat-mesh-core";
import {
  buildMiniCampaignDigest,
  capturePaneSnapshot,
  meshManagerPane,
  meshSecretaryPane,
  paneMetaForPane,
} from "seat-mesh-tmux";
import type { ToMasterRow } from "./create-queue-store.js";
import { paintMeshBorders, type BorderPaintConnectivity } from "./border-paint.js";
import { deliverToPane } from "./inject-delivery.js";
import type { QueueStore } from "./create-queue-store.js";
import { isInboxDelivered, isPeerDelivered } from "./create-queue-store.js";
import { drainPaneOpsOnce, type PaneOpsDrainCtx } from "./pane-ops-drain.js";
import { armRecipientCheckbackAfterPeer } from "./peer-comms-checkback.js";
import {
  isAckClassPeer,
  parkPeerToBacklog,
  pendingPeerRows,
  promotePeerBacklog,
  shouldBacklogPeerHold,
} from "./peer-backlog.js";
import {
  markPeerRowSkipped,
  shouldSkipDeliveredColdStart,
  shouldSkipGlobalWorkerRoomPing,
} from "./peer-skip.js";
import { deliveryHoldForPane } from "./delivery-hold.js";
import { markColdStartDelivered } from "seat-mesh-tmux";

export interface MeshOrchestratorCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  store: QueueStore;
  session: string;
  baseWindow: string;
  workersWindow: string;
  minisWindow: string;
  log: (line: string) => void;
  ocLimitedPaneIds: Set<string>;
  proxyDownActive?: boolean;
  paneOps?: PaneOpsDrainCtx;
}

function borderConnectivity(ctx: MeshOrchestratorCtx): BorderPaintConnectivity {
  return {
    proxyDownActive: ctx.proxyDownActive === true,
    ocLimitedPaneIds: ctx.ocLimitedPaneIds,
  };
}

export interface DrainTickResult {
  attempted: number;
  delivered: number;
  held: number;
}

/** ACK-class worker mail -> secretary first (harness parity); substance -> manager. */
export function isAckClassInbox(row: ToMasterRow): boolean {
  const msg = String(row.msg ?? "").trim();
  return /^(ACK|FYI|STAND-?BY|BUSY|MCP-?SYNCED)\b/i.test(msg);
}

function drainInboxLaneOnce(
  ctx: MeshOrchestratorCtx,
  lane: "secretary" | "manager",
): DrainTickResult {
  const rows = ctx.store.readInbox();
  const row = rows.find((r) => {
    if (r.resolved || isInboxDelivered(r)) return false;
    const ack = isAckClassInbox(r);
    return lane === "secretary" ? ack : !ack;
  });
  if (!row) return { attempted: 0, delivered: 0, held: 0 };

  if (row.sent && !row.sentAt) {
    ctx.log(`INBOX forge-reset id=${row.id} (sent:true without sentAt/deliverPane)`);
    row.sent = false;
  }

  const secPane = meshSecretaryPane(ctx.session, ctx.baseWindow);
  const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow);
  const targetPane = lane === "secretary" ? secPane : mgrPane;
  if (!targetPane) return { attempted: 0, delivered: 0, held: 0 };

  const payload = ctx.store.formatInboxInject(row, lane);
  const hold = deliveryHoldForPane(ctx, targetPane);
  if (hold.hold) {
    ctx.log(`INBOX held id=${row.id} lane=${lane} reason=${hold.reason}`);
    return { attempted: 1, delivered: 0, held: 1 };
  }
  const result = deliverToPane(targetPane, payload, ctx.registry);
  if (!result.ok) {
    ctx.log(`INBOX held id=${row.id} lane=${lane} reason=${result.reason}`);
    return { attempted: 1, delivered: 0, held: 1 };
  }
  const at = new Date().toISOString();
  row.sent = true;
  row.sentAt = at;
  row.deliveredTo = lane === "secretary" ? "secretary" : "manager";
  row.deliverPane = targetPane;
  row.deliverMode = result.mode;
  ctx.store.writeInbox(rows);
  ctx.log(
    `INBOX inject id=${row.id} lane=${lane} slot=${row.slot ?? "-"} to=${row.deliveredTo} provider=${result.providerId} mode=${result.mode} verified=${result.verified}`,
  );
  return { attempted: 1, delivered: 1, held: 0 };
}

/** Harness parity: secretary ACK lane + manager substance lane each poll tick. */
export function drainInboxOnce(ctx: MeshOrchestratorCtx): DrainTickResult {
  const sec = drainInboxLaneOnce(ctx, "secretary");
  const mgr = drainInboxLaneOnce(ctx, "manager");
  return {
    attempted: sec.attempted + mgr.attempted,
    delivered: sec.delivered + mgr.delivered,
    held: sec.held + mgr.held,
  };
}

/** Permanent skip only — transient holds (plain_shell during launch) must retry. */
const PEER_SKIP_REASONS = new Set(["no_snapshot", "no_provider"]);

const PEER_KIND_PRIORITY: Record<string, number> = {
  prompt: 0,
  remind: 1,
  "to-slot": 2,
  "to-mini": 3,
  room: 4,
};

function peerRowPriority(row: { kind: string; fromSlot?: string; at: string }): number {
  if (row.fromSlot === "mesh-cold-start") return -1;
  return PEER_KIND_PRIORITY[row.kind] ?? 9;
}

export function drainPeerOnce(ctx: MeshOrchestratorCtx): DrainTickResult {
  promotePeerBacklog(ctx.store, ctx.registry, ctx.log);

  const compacted = ctx.store.compactPeer();
  if (compacted > 0) {
    ctx.log(`PEER compact removed ${compacted} duplicate row(s)`);
  }

  const pending = pendingPeerRows(ctx.store).sort(
    (a, b) => peerRowPriority(a) - peerRowPriority(b) || a.at.localeCompare(b.at),
  );
  if (!pending.length) return { attempted: 0, delivered: 0, held: 0 };

  let attempted = 0;
  let delivered = 0;
  let held = 0;

  for (const row of pending) {
    if (row.sent && !row.sentAt) {
      ctx.log(`PEER forge-reset id=${row.id} (sent:true without proof)`);
      row.sent = false;
    }

    if (shouldSkipDeliveredColdStart(row)) {
      markPeerRowSkipped(ctx.store, row);
      ctx.log(`PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=cold-start-already-delivered`);
      continue;
    }

    if (shouldSkipGlobalWorkerRoomPing(row)) {
      markPeerRowSkipped(ctx.store, row);
      ctx.log(`PEER skip id=${row.id} -> ${row.targetLabel} reason=global-worker-thin-fyi`);
      continue;
    }

    const isColdStart = row.fromSlot === "mesh-cold-start";
    const hold = deliveryHoldForPane(ctx, row.targetPane, { isColdStart });
    if (hold.hold) {
      ctx.log(`PEER held id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=${hold.reason}`);
      held++;
      continue;
    }

    attempted++;
    const roomPing = row.kind === "room";
    const thinRoomPing = roomPing && /\[mesh-inbox-room\]/.test(row.msg);
    const toManager =
      row.targetLabel === "manager" ||
      row.targetLabel === "master" ||
      row.targetLabel === "manager" ||
      paneMetaForPane(row.targetPane)?.role === "manager";
    const lightweight = isAckClassPeer(row.msg) || roomPing;
    const result = deliverToPane(row.targetPane, row.msg, ctx.registry, {
      lightweight,
      // Thin room ledger pings bypass coord idle-settle (manager/manager-b/secretary).
      roomPing: thinRoomPing || (roomPing && !toManager),
    });
    if (!result.ok) {
      if (PEER_SKIP_REASONS.has(result.reason)) {
        const rows = ctx.store.readPeer();
        const i = rows.findIndex((r) => r.id === row.id);
        if (i >= 0) {
          rows[i]!.sent = true;
          rows[i]!.sentAt = new Date().toISOString();
          rows[i]!.deliverPane = "skipped";
          rows[i]!.deliverMode = "idle";
          ctx.store.writePeer(rows);
        }
        ctx.log(`PEER skip id=${row.id} -> ${row.targetLabel} reason=${result.reason}`);
        continue;
      }
      if (shouldBacklogPeerHold(result.reason, row.msg)) {
        parkPeerToBacklog(ctx.store, row, result.reason, ctx.log);
        continue;
      }
      ctx.log(`PEER held id=${row.id} reason=${result.reason}`);
      held++;
      continue;
    }
    const rows = ctx.store.readPeer();
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) {
      rows[i]!.sent = true;
      rows[i]!.sentAt = new Date().toISOString();
      rows[i]!.deliverPane = row.targetPane;
      rows[i]!.deliverMode = result.mode;
      ctx.store.writePeer(rows);
    }
    const from =
      row.kind === "room"
        ? row.fromSlot
        : row.kind === "prompt" || row.kind === "remind"
          ? row.fromSlot
          : `slot-${row.fromSlot}`;
    ctx.log(
      `PEER inject ${row.kind} -> ${row.targetLabel} from ${from} provider=${result.providerId} mode=${result.mode}`,
    );
    if (isColdStart) {
      markColdStartDelivered(ctx.loaded, row.targetPane);
    }
    armRecipientCheckbackAfterPeer(ctx.store, ctx.loaded, row);
    delivered++;
  }

  return { attempted, delivered, held };
}

/** Max due checkbacks handled per drain tick — avoids wedging /health on burst renew. */
const CHECKBACK_FIRE_BUDGET = 1;

export function fireDueCheckbacks(ctx: MeshOrchestratorCtx): void {
  const now = Date.now();
  const rows = ctx.store.readCheckbacks();
  let processed = 0;
  for (const row of rows) {
    if (row.status !== "active") continue;
    const exp = row.expiresAt ? Date.parse(row.expiresAt) : 0;
    if (!exp || exp > now) continue;
    if (processed >= CHECKBACK_FIRE_BUDGET) break;
    processed++;
    const pane = row.ownerPane;
    if (!pane) continue;

    if (row.kind === "mesh-watch") {
      const digest = buildMiniCampaignDigest(ctx.loaded);
      if (digest.allDone) {
        row.status = "cancelled";
        row.updatedAt = new Date().toISOString();
        ctx.log(`mesh-watch AUTO-OFF campaign complete ${digest.done}/${digest.total}`);
        continue;
      }
      const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow);
      const digestBlock = `[mesh-inbox] DIGEST: ${digest.text}`;
      if (mgrPane) {
        deliverToPane(mgrPane, digestBlock, ctx.registry, { skipVerify: true });
      }
      const secMsg = `${formatCompactSeat({ role: "secretary" })} | [mesh-inbox] DIGEST INCOMPLETE: ${digest.done}/${digest.total} open=[${digest.openIds.join(",")}] — ./sm.sh secretary collect --nudge`;
      deliverToPane(pane, secMsg, ctx.registry, { skipVerify: true });
      ctx.log(`mesh-watch digest done=${digest.done}/${digest.total} open=${digest.openIds.join(",") || "none"}`);
    } else if (row.kind === "manager-nudge") {
      // Supervisee is always manager — never worker slots 1-8 / minis.
      const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow) || undefined;
      if (mgrPane && pane && pane !== mgrPane) {
        ctx.log(`manager-nudge retarget ${pane} -> ${mgrPane} (supervisee must be manager)`);
        row.ownerPane = mgrPane;
        ctx.store.writeCheckbacks(rows);
      }
      if (mgrPane) {
        const snap = capturePaneSnapshot(mgrPane);
        const prov = snap ? ctx.registry.detect(snap) : null;
        const state = prov && snap ? prov.composerState(snap) : null;
        const idle =
          !state ||
          state.phase === "empty" ||
          state.phase === "afk" ||
          state.phase === "plain_shell";
        if (idle) {
          const msg =
            "[mesh-inbox] CONTINUE: read manager/FOCUS + seat-mesh/TODO; next authorized slice (no operator yes/continue)";
          const r = deliverToPane(mgrPane, msg, ctx.registry, { skipVerify: true });
          ctx.log(
            `manager-nudge ${r.ok ? "delivered" : `held:${r.reason}`} pane=${mgrPane}`,
          );
        } else {
          ctx.log(
            `manager-nudge skip (phase=${state?.phase ?? "?"}) pane=${mgrPane}`,
          );
        }
      }
    } else if (row.kind === "secretary-supervise") {
      const secMsg =
        `${formatCompactSeat({ role: "secretary" })} | [mesh-inbox] SUPERVISE: ./sm.sh contexts; idle manager + open FOCUS -> to-master CONTINUE`;
      const r = deliverToPane(pane, secMsg, ctx.registry, { skipVerify: true });
      ctx.log(
        `secretary-supervise ${r.ok ? "delivered" : `held:${r.reason}`} pane=${pane}`,
      );
    } else if (row.expect && (row.kind === "room-call" || isRoomCallExpect(row.expect))) {
      const meta = pane ? paneMetaForPane(pane) : null;
      const msg = formatRoomCallCheckback(row.expect, {
        role: meta?.role || row.recipientLabel || "worker",
        slot: meta?.slot,
        mini: meta?.mini,
        ports: meta?.ports,
        workerCount: ctx.loaded.profile.session.workerCount,
        miniMax: ctx.loaded.profile.session.miniMax,
      });
      const r = deliverToPane(pane, msg, ctx.registry, { skipVerify: true });
      if (!r.ok) continue;
      ctx.log(`room-call checkback pane=${pane} expect=${row.expect}`);
    } else if (
      row.expect &&
      (row.kind === "room-comms" || row.expect.startsWith("chat-room:"))
    ) {
      const meta = pane ? paneMetaForPane(pane) : null;
      const msg = formatRoomCommsCheckback(row.expect, {
        role: meta?.role || row.recipientLabel || "worker",
        slot: meta?.slot,
        mini: meta?.mini,
        ports: meta?.ports,
        workerCount: ctx.loaded.profile.session.workerCount,
        miniMax: ctx.loaded.profile.session.miniMax,
      });
      const r = deliverToPane(pane, msg, ctx.registry, { skipVerify: true });
      if (!r.ok) continue;
      ctx.log(`room-comms checkback pane=${pane} expect=${row.expect}`);
    } else {
      const meta = pane ? paneMetaForPane(pane) : null;
      const cbCtx = {
        role: meta?.role || row.recipientLabel || "worker",
        slot: meta?.slot,
        mini: meta?.mini,
        ports: meta?.ports,
        workerCount: ctx.loaded.profile.session.workerCount,
        miniMax: ctx.loaded.profile.session.miniMax,
      };
      const expect = row.expect ?? row.kind;
      const msg = formatGenericCheckback(expect, cbCtx);
      const r = deliverToPane(pane, msg, ctx.registry, { skipVerify: true });
      if (!r.ok) continue;
      ctx.log(`checkback pane=${pane} expect=${expect.slice(0, 80)}`);
    }

    if (row.renewSec && row.renewSec > 0) {
      row.expiresAt = new Date(now + row.renewSec * 1000).toISOString();
      row.updatedAt = new Date().toISOString();
    } else {
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
    }
  }
  ctx.store.writeCheckbacks(rows);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function orchestratorDrainTick(ctx: MeshOrchestratorCtx): DrainTickResult {
  if (ctx.paneOps) {
    drainPaneOpsOnce(ctx.paneOps);
  }
  const a = drainInboxOnce(ctx);
  const b = drainPeerOnce(ctx);
  fireDueCheckbacks(ctx);
  paintMeshBorders(
    ctx.loaded,
    ctx.registry,
    ctx.store,
    ctx.session,
    ctx.baseWindow,
    ctx.workersWindow,
    ctx.minisWindow,
    new Set(),
    borderConnectivity(ctx),
    ctx.store.stateDir,
  );
  return {
    attempted: a.attempted + b.attempted,
    delivered: a.delivered + b.delivered,
    held: a.held + b.held,
  };
}

/** Yield between heavy steps so daemon /health can answer during drain. */
export async function orchestratorDrainTickAsync(ctx: MeshOrchestratorCtx): Promise<DrainTickResult> {
  if (ctx.paneOps) {
    drainPaneOpsOnce(ctx.paneOps);
  }
  await yieldEventLoop();
  const a = drainInboxOnce(ctx);
  await yieldEventLoop();
  const b = drainPeerOnce(ctx);
  await yieldEventLoop();
  fireDueCheckbacks(ctx);
  await yieldEventLoop();
  paintMeshBorders(
    ctx.loaded,
    ctx.registry,
    ctx.store,
    ctx.session,
    ctx.baseWindow,
    ctx.workersWindow,
    ctx.minisWindow,
    new Set(),
    borderConnectivity(ctx),
    ctx.store.stateDir,
  );
  return {
    attempted: a.attempted + b.attempted,
    delivered: a.delivered + b.delivered,
    held: a.held + b.held,
  };
}

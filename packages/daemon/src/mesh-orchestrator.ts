import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  chatRoomConfigForLoaded,
  formatCompactSeat,
  formatGenericCheckback,
  formatRoomCallCheckback,
  formatRoomCommsCheckback,
  isRoomCallExpect,
  lastInboundRoomFrom,
  listRoomMessages,
  meshInboxContinueLead,
  meshInboxDigestBlock,
  meshInboxDigestIncomplete,
  loadBalanceVendorContract,
  contractsDirFor,
  hubLockActive,
  meshInboxBalanceLeadTick,
  meshInboxBalanceStatus,
  parseRoomCommsExpect,
  resolveAgentId,
} from "@seat-mesh/core";
import {
  buildMiniCampaignDigest,
  capturePaneSnapshot,
  coordPaneForRole,
  meshManagerPane,
  meshSecretaryPane,
  paneMetaForPane,
  readSeatSnapshot,
  runBalanceTick,
  runSuperviseTick,
} from "@seat-mesh/tmux";
import type { CheckbackRow, ToMasterRow } from "./create-queue-store.js";
import {
  paintMeshBorders,
  paintMeshBordersAsync,
  type BorderPaintConnectivity,
} from "./border-paint.js";
import { deliverToPane } from "./inject-delivery.js";
import {
  armCcLimitRetryCheckback,
  ccLimitRetryFingerprintFromExpect,
  meshInboxCcLimitRetryContinue,
  paneMatchesCcLimitFingerprint,
  paneSessionFingerprint,
  parseCcLimitRetryAtMs,
} from "./cc-limit-retry.js";
import type { QueueStore } from "./create-queue-store.js";
import { isInboxDelivered, isPeerDelivered } from "./create-queue-store.js";
import { drainPaneOpsOnce, type PaneOpsDrainCtx } from "./pane-ops-drain.js";
import { armRecipientCheckbackAfterPeer } from "./peer-comms-checkback.js";
import {
  deferCheckbackAfterFailedFire,
  sortDueCheckbackIndices,
} from "./checkback-fire.js";
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
  shouldSkipManagerStatusRoomPing,
} from "./peer-skip.js";
import { deliveryHoldForPane } from "./delivery-hold.js";
import { evaluateInboxOverload } from "./inbox-overload.js";
import { markColdStartDelivered } from "@seat-mesh/tmux";

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

function gateDelivery(
  ctx: MeshOrchestratorCtx,
  paneId: string,
  opts: { isColdStart?: boolean; skipOverload?: boolean } = {},
): { blocked: boolean; reason?: string } {
  const hold = deliveryHoldForPane(ctx, paneId, opts);
  if (hold.hold) return { blocked: true, reason: hold.reason };

  if (opts.skipOverload) return { blocked: false };

  const ov = evaluateInboxOverload(ctx.store, paneId);
  if (ov.warn && ov.warnMessage) {
    ctx.log(`INBOX overload warn pane=${paneId} triggers=${ov.count} cooldown=10m`);
    deliverToPane(paneId, ov.warnMessage, ctx.registry, {
      force: true,
      skipVerify: true,
      loaded: ctx.loaded,
    });
  }
  if (ov.hold) {
    ctx.log(`INBOX overload hold pane=${paneId} triggers=${ov.count} reason=${ov.reason}`);
    return { blocked: true, reason: ov.reason };
  }
  return { blocked: false };
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
  const gate = gateDelivery(ctx, targetPane);
  if (gate.blocked) {
    ctx.log(`INBOX held id=${row.id} lane=${lane} reason=${gate.reason}`);
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

    if (shouldSkipManagerStatusRoomPing(row)) {
      markPeerRowSkipped(ctx.store, row);
      ctx.log(`PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=manager-status-room`);
      continue;
    }

    if (
      hubLockActive(ctx.loaded.workspace) &&
      isAckClassPeer(row.msg) &&
      (row.targetLabel === "manager" ||
        row.targetLabel === "manager-2" ||
        row.targetLabel === "secretary")
    ) {
      markPeerRowSkipped(ctx.store, row);
      ctx.log(`PEER skip id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=hub-lock`);
      continue;
    }

    const isColdStart = row.fromSlot === "mesh-cold-start";
    const gate = gateDelivery(ctx, row.targetPane, { isColdStart });
    if (gate.blocked) {
      ctx.log(`PEER held id=${row.id.slice(0, 8)} -> ${row.targetLabel} reason=${gate.reason}`);
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
      // Thin room ledger pings bypass coord idle-settle (manager/manager-b/secretary) —
      // except humanCoTyped panes (default manager-2), which never get that bypass.
      roomPing: thinRoomPing || (roomPing && !toManager),
      loaded: ctx.loaded,
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

/** Due checkbacks per drain tick — supervise lane + one comms peer. */
const CHECKBACK_FIRE_BUDGET = 2;

/** Cancel legacy per-pane STATUS checkbacks (they spammed manager with Check: injects). */
function cancelSuperviseStatusCheckbacks(ctx: MeshOrchestratorCtx): void {
  const rows = ctx.store.readCheckbacks();
  let changed = false;
  for (const row of rows) {
    if (row.status !== "active") continue;
    if (row.kind !== "supervise-status" && !row.id.startsWith("cb-supervise-status-")) continue;
    row.status = "cancelled";
    row.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) ctx.store.writeCheckbacks(rows);
}

/** Daemon-native supervise — ledger + optional room STATUS + idle lead CONTINUE (no secretary inject). */
function deliverSecretarySuperviseTick(ctx: MeshOrchestratorCtx, _secPane: string): boolean {
  cancelSuperviseStatusCheckbacks(ctx);
  const tick = runSuperviseTick(ctx.loaded, {
    session: ctx.session,
    baseWindow: ctx.baseWindow,
    registry: ctx.registry,
    deliverContinue: (role, leadPane) => {
      const msg = meshInboxContinueLead(role);
      const r = deliverToPane(leadPane, msg, ctx.registry, {
        skipVerify: true,
        intent: "continue",
        loaded: ctx.loaded,
      });
      ctx.log(`supervise-continue ${role} ${r.ok ? "ok" : r.reason} pane=${leadPane}`);
      return r.ok;
    },
  });
  ctx.log(
    `supervise-tick ledger=${tick.wroteLedger} material=${tick.materialChange} room=${tick.roomStatusPosted} nudged=${tick.nudged.join(",") || "none"} line=${tick.statusLine}`,
  );
  return tick.wroteLedger;
}

/** Balance lead tick — manager-2 pane only; runBalanceTick writes BALANCE-LAST. */
function deliverBalanceLeadTick(ctx: MeshOrchestratorCtx, leadPane: string): boolean {
  const tick = runBalanceTick(ctx.loaded);
  const msg = `${meshInboxBalanceStatus(tick.statusLine)} ${meshInboxBalanceLeadTick().replace(/^\[mesh-inbox\] /, "")}`;
  const r = deliverToPane(leadPane, msg, ctx.registry, {
    skipVerify: true,
    force: true,
    loaded: ctx.loaded,
  });
  try {
    const doc = loadBalanceVendorContract(contractsDirFor(ctx.loaded));
    ctx.log(
      `balance-lead-tick ${r.ok ? "delivered" : r.reason} pane=${leadPane} lead=${doc.balance_lead}`,
    );
  } catch {
    ctx.log(`balance-lead-tick ${r.ok ? "delivered" : r.reason} pane=${leadPane}`);
  }
  return r.ok;
}

function deferFailedFire(
  ctx: MeshOrchestratorCtx,
  row: CheckbackRow,
  now: number,
  reason: string,
): void {
  deferCheckbackAfterFailedFire(row, now);
  ctx.log(`checkback hold-defer id=${row.id} kind=${row.kind ?? "?"} reason=${reason}`);
}

export function fireDueCheckbacks(ctx: MeshOrchestratorCtx): void {
  const now = Date.now();
  const rows = ctx.store.readCheckbacks();
  const dueIndices = sortDueCheckbackIndices(rows, now);
  let processed = 0;
  for (const idx of dueIndices) {
    if (processed >= CHECKBACK_FIRE_BUDGET) break;
    processed++;
    const row = rows[idx];
    const pane = row.ownerPane;
    if (!pane) continue;

    if (row.kind !== "manager-nudge") {
      const cbGate = gateDelivery(ctx, pane);
      if (cbGate.blocked) {
        ctx.log(`checkback held id=${row.id} kind=${row.kind} pane=${pane} reason=${cbGate.reason}`);
        deferFailedFire(ctx, row, now, cbGate.reason ?? "overload");
        continue;
      }
    }

    if (row.kind === "mesh-watch") {
      const digest = buildMiniCampaignDigest(ctx.loaded);
      if (digest.allDone) {
        row.status = "cancelled";
        row.updatedAt = new Date().toISOString();
        ctx.log(`mesh-watch AUTO-OFF campaign complete ${digest.done}/${digest.total}`);
        continue;
      }
      const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow);
      const digestBlock = meshInboxDigestBlock(digest.text);
      if (mgrPane) {
        deliverToPane(mgrPane, digestBlock, ctx.registry, { skipVerify: true });
      }
      const secMsg = `${formatCompactSeat({ role: "secretary" })} | ${meshInboxDigestIncomplete({
        done: digest.done,
        total: digest.total,
        openIds: digest.openIds,
      })}`;
      deliverToPane(pane, secMsg, ctx.registry, { skipVerify: true });
      ctx.log(`mesh-watch digest done=${digest.done}/${digest.total} open=${digest.openIds.join(",") || "none"}`);
    } else if (row.kind === "manager-nudge") {
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
      ctx.log("manager-nudge cancelled (disabled — protect manager lead health)");
    } else if (row.kind === "manager-2-nudge") {
      const role: "manager-2" = "manager-2";
      const leadPane = coordPaneForRole(ctx.session, ctx.baseWindow, role) || undefined;
      if (leadPane && pane && pane !== leadPane) {
        ctx.log(`${row.kind} retarget ${pane} -> ${leadPane} (supervisee must be ${role})`);
        row.ownerPane = leadPane;
        ctx.store.writeCheckbacks(rows);
      }
      if (leadPane) {
        const snap = readSeatSnapshot(ctx.loaded, { role });
        if ((snap?.tasks.open ?? 0) === 0) {
          ctx.log(`${row.kind} skip (0 open TASKS) pane=${leadPane}`);
        } else {
        const cap = capturePaneSnapshot(leadPane);
        const prov = cap ? ctx.registry.detect(cap) : null;
        const state = prov && cap ? prov.composerState(cap) : null;
        const idle =
          !state ||
          state.phase === "empty" ||
          state.phase === "afk" ||
          state.phase === "plain_shell";
        if (idle) {
          const msg = meshInboxContinueLead(role);
          const r = deliverToPane(leadPane, msg, ctx.registry, {
            skipVerify: true,
            intent: "continue",
            loaded: ctx.loaded,
          });
          ctx.log(`${row.kind} ${r.ok ? "delivered" : r.reason} pane=${leadPane}`);
          // Transient gate hold (e.g. wait-settle) — retry on the next drain tick
          // instead of silently re-arming for the full renewSec (was: nudge could
          // go dark for a whole 5min cycle every time it raced a settle window).
          if (!r.ok) {
            deferFailedFire(ctx, row, now, r.reason ?? "deliver");
            continue;
          }
        } else {
          ctx.log(`${row.kind} skip (phase=${state?.phase ?? "?"}) pane=${leadPane}`);
        }
        }
      }
    } else if (row.kind === "secretary-supervise") {
      const ok = deliverSecretarySuperviseTick(ctx, pane);
      if (!ok) {
        deferFailedFire(ctx, row, now, "supervise-tick");
        continue;
      }
    } else if (row.kind === "cc-limit-retry") {
      const fp =
        row.sessionFingerprint ??
        ccLimitRetryFingerprintFromExpect(row.expect ?? "") ??
        "";
      if (!fp || !paneMatchesCcLimitFingerprint(ctx.registry, pane, fp)) {
        row.status = "cancelled";
        row.updatedAt = new Date().toISOString();
        ctx.log(`cc-limit-retry cancel pane=${pane} (session replaced)`);
        continue;
      }
      const meta = pane ? paneMetaForPane(pane) : null;
      const role = meta?.role ?? "worker";
      const leadRole =
        role === "manager" || role === "manager-2" ? (role as "manager" | "manager-2") : null;
      const msg = leadRole
        ? meshInboxCcLimitRetryContinue(leadRole)
        : `${formatCompactSeat({
            role,
            slot: meta?.slot,
            mini: meta?.mini,
            ports: meta?.ports,
          })} | [mesh-inbox] intent=limit-retry CONTINUE: limit window passed — resume open TASK/hub (no chat reply)`;
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "limit-retry",
        loaded: ctx.loaded,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
      ctx.log(`cc-limit-retry delivered pane=${pane}`);
    } else if (row.kind === "balance-lead-tick") {
      const role: "manager-2" = "manager-2";
      const leadPane = coordPaneForRole(ctx.session, ctx.baseWindow, role) || pane;
      if (leadPane && pane && pane !== leadPane) {
        row.ownerPane = leadPane;
        ctx.store.writeCheckbacks(rows);
      }
      const ok = deliverBalanceLeadTick(ctx, leadPane ?? pane);
      if (!ok) {
        deferFailedFire(ctx, row, now, "balance-tick");
        continue;
      }
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
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
      ctx.log(`room-call checkback pane=${pane} expect=${row.expect}`);
    } else if (
      row.expect &&
      (row.kind === "room-comms" || row.expect.startsWith("chat-room:"))
    ) {
      const meta = pane ? paneMetaForPane(pane) : null;
      const parsed = parseRoomCommsExpect(row.expect);
      const selfId = resolveAgentId({
        role: meta?.role || row.recipientLabel || "worker",
        slot: meta?.slot != null ? Number(meta.slot) : null,
        mini: meta?.mini ?? null,
      });
      let from: string | null = null;
      if (parsed) {
        try {
          const cfg = chatRoomConfigForLoaded(ctx.loaded);
          from = lastInboundRoomFrom(
            listRoomMessages(ctx.loaded.workspace, cfg, parsed.slug),
            selfId,
          );
        } catch {
          from = null;
        }
      }
      const msg = formatRoomCommsCheckback(
        row.expect,
        {
          role: meta?.role || row.recipientLabel || "worker",
          slot: meta?.slot,
          mini: meta?.mini,
          ports: meta?.ports,
          workerCount: ctx.loaded.profile.session.workerCount,
          miniMax: ctx.loaded.profile.session.miniMax,
        },
        from,
        { verifyOnly: true },
      );
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
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
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
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
  await paintMeshBordersAsync(
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

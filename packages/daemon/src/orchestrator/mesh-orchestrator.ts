import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  chatRoomConfigForLoaded,
  formatCheckbackCancelHint,
  formatCompactSeat,
  formatGenericCheckback,
  formatPeerBulkDigest,
  formatRoomCallCheckback,
  formatRoomCommsCheckback,
  isAckClassPeer,
  meshInboxCheckbackVerify,
  isRoomCallExpect,
  lastInboundRoomFrom,
  listRoomMessages,
  meshInboxContinueLead,
  meshInboxDigestBlock,
  meshInboxDigestIncomplete,
  loadBalanceVendorContract,
  contractsDirFor,
  isManagerKind,
  isSecretaryKind,
  meshInboxBalanceLeadTick,
  meshInboxBalanceStatus,
  parseRoomCommsExpect,
  resolveAgentId,
  resolveCheckbackMaxFires,
  takePeerBulkBatch,
  type PeerBulkItem,
} from "@seat-mesh/core";
import {
  buildMiniCampaignDigest,
  capturePaneSnapshot,
  coordPaneForRole,
  meshManagerPane,
  meshSecretaryPane,
  paneMetaForPane,
  readSeatSnapshot,
  handleCoordExpectDue,
  parseCoordExpect,
  runBalanceAutoActions,
  runBalanceTick,
  runSuperviseTick,
} from "@seat-mesh/tmux";
import type { CheckbackRow, ToMasterRow } from "../store/create-queue-store.js";
import {
  paintMeshBorders,
  paintMeshBordersAsync,
  repaintMeshPaneBorder,
  type BorderPaintConnectivity,
} from "../border/border-paint.js";
import { createStepErrorLog } from "./step-isolation.js";
import { fireDueTargets } from "../target/target-fire.js";
import { deliverToPane } from "../inject/inject-delivery.js";
import {
  armCcLimitRetryCheckback,
  ccLimitRetryFingerprintFromExpect,
  meshInboxCcLimitRetryContinue,
  paneMatchesCcLimitFingerprint,
  paneSessionFingerprint,
  parseCcLimitRetryAtMs,
} from "../connectivity/cc-limit-retry.js";
import type { QueueStore } from "../store/create-queue-store.js";
import { isInboxDelivered, isPeerDelivered } from "../store/create-queue-store.js";
import { drainPaneOpsOnce, type PaneOpsDrainCtx } from "../inbox/pane-ops-drain.js";
import {
  deferCheckbackAfterFailedFire,
  shouldRenewCheckback,
  sortDueCheckbackIndices,
} from "../checkback/checkback-fire.js";
import { bindCheckbackOwnerPane } from "../checkback/checkback-scope.js";
import { pendingPeerRows, promotePeerBacklog } from "../peer/peer-backlog.js";
import { drainPeerPaneBulk, refreshAndGroupPeers } from "../peer/peer-bulk-drain.js";
import { deliveryHoldForPane } from "../inbox/delivery-hold.js";
import { evaluateInboxOverload } from "../inbox/inbox-overload.js";
import {
  ackSweepTick,
  openAckForDeliveredInbox,
} from "../ack/ack-sweep.js";
import { notePaneDeliveryHold } from "../inject/pane-hold.js";
import { pollSecretaryAutoRestart } from "../recovery/secretary-auto-restart.js";
import { pollPaneAutoRevive } from "../recovery/pane-auto-revive.js";
import { pollLayoutAutoScale } from "../recovery/layout-auto-scale.js";

export interface MeshOrchestratorCtx {
  loaded: LoadedProfile;
  registry: ProviderRegistry;
  store: QueueStore;
  session: string;
  /** Base tmux window name (secretary pane lives here). */
  baseWindow: string;
  workersWindow: string;
  minisWindow: string;
  log: (line: string) => void;
  ocLimitedPaneIds: Set<string>;
  connectPaneIds?: Set<string>;
  proxyDownActive?: boolean;
  paneOps?: PaneOpsDrainCtx;
}

function borderConnectivity(ctx: MeshOrchestratorCtx): BorderPaintConnectivity {
  return {
    proxyDownActive: ctx.proxyDownActive === true,
    ocLimitedPaneIds: ctx.ocLimitedPaneIds,
    connectPaneIds: ctx.connectPaneIds ?? new Set(),
  };
}

function repaintPaneBanner(ctx: MeshOrchestratorCtx, paneId: string, label: string): void {
  repaintMeshPaneBorder(
    ctx.registry,
    ctx.store,
    paneId,
    borderConnectivity(ctx),
    isSecretaryKind(label),
    label,
    ctx.store.stateDir,
    undefined,
    ctx.loaded,
  );
}

function gateDelivery(
  ctx: MeshOrchestratorCtx,
  paneId: string,
  opts: {
    isColdStart?: boolean;
    skipOverload?: boolean;
    allowCheckbackComms?: boolean;
  } = {},
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
      workspace: ctx.loaded.workspace,
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
  return isAckClassPeer(String(row.msg ?? ""));
}

function inboxLaneFrom(row: ToMasterRow): string {
  const from = String(row.from ?? "").trim();
  const slot = row.slot != null ? String(row.slot) : "";
  if (from === "secretary" || from === "manager" || slot === "secretary" || slot === "manager") {
    return from || slot;
  }
  if (/^\d+$/.test(slot)) return `slot-${slot}`;
  return from || slot || "unknown";
}

function drainInboxLaneOnce(
  ctx: MeshOrchestratorCtx,
  lane: "secretary" | "manager",
): DrainTickResult {
  const rows = ctx.store.readInbox();
  const pending = rows.filter((r) => {
    if (r.resolved || isInboxDelivered(r)) return false;
    const ack = isAckClassInbox(r);
    return lane === "secretary" ? ack : !ack;
  });
  if (!pending.length) return { attempted: 0, delivered: 0, held: 0 };

  for (const row of pending) {
    if (row.sent && !row.sentAt) {
      ctx.log(`INBOX forge-reset id=${row.id} (sent:true without sentAt/deliverPane)`);
      row.sent = false;
    }
  }

  const secPane = meshSecretaryPane(ctx.session, ctx.baseWindow);
  const mgrPane = meshManagerPane(ctx.session, ctx.baseWindow);
  const targetPane = lane === "secretary" ? secPane : mgrPane;
  if (!targetPane) return { attempted: 0, delivered: 0, held: 0 };

  const { batch } = takePeerBulkBatch(pending);
  const gate = gateDelivery(ctx, targetPane);
  if (gate.blocked) {
    notePaneDeliveryHold(targetPane, gate.reason ?? "hold");
    ctx.log(`INBOX held id=${batch[0]!.id} lane=${lane} reason=${gate.reason}`);
    return { attempted: 1, delivered: 0, held: 1 };
  }

  const useBulk = batch.length > 1;
  const payload = useBulk
    ? formatPeerBulkDigest({
        seat: lane,
        items: batch.map(
          (r): PeerBulkItem => ({
            from: inboxLaneFrom(r),
            body: ctx.store.formatInboxInject(r, lane),
          }),
        ),
        more: Math.max(0, pending.length - batch.length),
      })
    : ctx.store.formatInboxInject(batch[0]!, lane);

  const result = deliverToPane(targetPane, payload, ctx.registry, {
    loaded: ctx.loaded,
    workspace: ctx.loaded.workspace,
  });
  if (!result.ok) {
    notePaneDeliveryHold(targetPane, result.reason);
    ctx.log(`INBOX held id=${batch[0]!.id} lane=${lane} reason=${result.reason}`);
    return { attempted: 1, delivered: 0, held: 1 };
  }
  const at = new Date().toISOString();
  for (const row of batch) {
    row.sent = true;
    row.sentAt = at;
    row.deliveredTo = lane === "secretary" ? "secretary" : "manager";
    row.deliverPane = targetPane;
    row.deliverMode = result.mode;
    openAckForDeliveredInbox(ctx, row, lane, targetPane);
  }
  ctx.store.writeInbox(rows);
  ctx.log(
    useBulk
      ? `INBOX inject bulk=${batch.length} lane=${lane} provider=${result.providerId} mode=${result.mode} verified=${result.verified}`
      : `INBOX inject id=${batch[0]!.id} lane=${lane} slot=${batch[0]!.slot ?? "-"} to=${batch[0]!.deliveredTo} provider=${result.providerId} mode=${result.mode} verified=${result.verified}`,
  );
  repaintPaneBanner(ctx, targetPane, lane === "secretary" ? "secretary" : "manager");
  return { attempted: 1, delivered: batch.length, held: 0 };
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
  /** One substance paste per pane per tick — DIGEST folds ≤5 into that paste. */
  const injectedThisTick = new Set<string>();

  const { byPane, held: heldRefresh } = refreshAndGroupPeers(ctx, pending);
  held += heldRefresh;

  for (const [paneId, paneRows] of byPane) {
    const r = drainPeerPaneBulk(ctx, paneId, paneRows, gateDelivery, injectedThisTick);
    attempted += r.attempted;
    delivered += r.delivered;
    held += r.held;
    if (r.delivered > 0) {
      repaintPaneBanner(ctx, paneId, paneRows[0]!.targetLabel || "");
    }
  }

  return { attempted, delivered, held };
}

/** Due checkbacks per drain tick — supervise lane + comms (raise when many armed). */
const CHECKBACK_FIRE_BUDGET = 6;

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
      workspace: ctx.loaded.workspace,
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

/** Balance lead tick — ledger + room STATUS + auto-assign; pane inject is best-effort only. */
function deliverBalanceLeadTick(ctx: MeshOrchestratorCtx, leadPane: string): boolean {
  const tick = runBalanceTick(ctx.loaded);
  const auto = runBalanceAutoActions(ctx.loaded, tick);
  const msg = `${meshInboxBalanceStatus(tick.statusLine)} ${meshInboxBalanceLeadTick().replace(/^\[mesh-inbox\] /, "")}`;
  const r = deliverToPane(leadPane, msg, ctx.registry, {
    skipVerify: true,
    force: true,
    intent: "status",
    loaded: ctx.loaded,
      workspace: ctx.loaded.workspace,
  });
  const material =
    tick.wroteLedger &&
    (auto.roomStatusPosted || auto.autoPullAssigned || auto.balanceeAssigned.length > 0 || r.ok);
  try {
    const doc = loadBalanceVendorContract(contractsDirFor(ctx.loaded));
    ctx.log(
      `balance-lead-tick material=${material} inject=${r.ok ? "ok" : r.reason} room=${auto.roomStatusPosted} pull=${auto.autoPullAssigned} balancees=${auto.balanceeAssigned.join(",") || "none"} lead=${doc.balance_lead}`,
    );
  } catch {
    ctx.log(
      `balance-lead-tick material=${material} inject=${r.ok ? "ok" : r.reason} pane=${leadPane}`,
    );
  }
  return material;
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
    const bound = bindCheckbackOwnerPane(ctx.loaded, row);
    if (bound.cancelReason === "pane-gone") {
      ctx.log(`checkback hold-defer id=${row.id} kind=${row.kind ?? "?"} reason=pane-gone`);
      deferFailedFire(ctx, row, now, "pane-gone");
      continue;
    }
    if (bound.cancelReason) {
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
      ctx.log(
        `checkback cancel id=${row.id} kind=${row.kind ?? "?"} reason=${bound.cancelReason} wasPane=${row.ownerPane ?? "-"}`,
      );
      continue;
    }
    if (bound.rerouted && bound.paneId) {
      ctx.log(
        `checkback retarget id=${row.id} ${row.ownerPane} -> ${bound.paneId} (session-scope)`,
      );
      row.ownerPane = bound.paneId;
      ctx.store.writeCheckbacks(rows);
    }
    const pane = bound.paneId ?? row.ownerPane;
    if (!pane) continue;

    if (row.kind !== "manager-nudge") {
      const cbGate = gateDelivery(ctx, pane, { allowCheckbackComms: true });
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
        deliverToPane(mgrPane, digestBlock, ctx.registry, { skipVerify: true, loaded: ctx.loaded,
      workspace: ctx.loaded.workspace });
      }
      const secMsg = `${formatCompactSeat({ role: "secretary" })} | ${meshInboxDigestIncomplete({
        done: digest.done,
        total: digest.total,
        openIds: digest.openIds,
      })}`;
      deliverToPane(pane, secMsg, ctx.registry, { skipVerify: true, loaded: ctx.loaded,
      workspace: ctx.loaded.workspace });
      ctx.log(`mesh-watch digest done=${digest.done}/${digest.total} open=${digest.openIds.join(",") || "none"}`);
    } else if (row.kind === "manager-nudge") {
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
      ctx.log("manager-nudge cancelled (disabled — protect manager lead health)");
    } else if (row.kind === "coord-nudge" || (row.kind?.endsWith("-nudge") && row.kind !== "manager-nudge")) {
      const role =
        row.recipientLabel?.trim() ||
        paneMetaForPane(pane)?.role ||
        "";
      if (!role) {
        ctx.log(`${row.kind} skip (no recipient)`);
        continue;
      }
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
      workspace: ctx.loaded.workspace,
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
      // Must still be Claude with the same session — OC/kiro/cursor swap cancels.
      if (!fp || !paneMatchesCcLimitFingerprint(ctx.registry, pane, fp)) {
        row.status = "cancelled";
        row.updatedAt = new Date().toISOString();
        ctx.log(
          `cc-limit-retry cancel pane=${pane} (not claude or session replaced)`,
        );
        continue;
      }
      const meta = pane ? paneMetaForPane(pane) : null;
      const role = meta?.role || "plain";
      const leadRole = isManagerKind(role) ? role : null;
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
      workspace: ctx.loaded.workspace,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
      ctx.log(`cc-limit-retry delivered pane=${pane}`);
    } else if (row.kind === "coord-expect" && row.expect) {
      const parsed = parseCoordExpect(row.expect);
      const pane = row.ownerPane;
      if (!pane) continue;
      const outcome = handleCoordExpectDue(ctx.loaded, row.expect);
      if (outcome.met) {
        row.status = "cancelled";
        row.updatedAt = new Date().toISOString();
        ctx.log(`coord-expect met target=${parsed?.target ?? "?"} hub=${parsed?.hub ?? "?"}`);
        continue;
      }
      const msg = meshInboxCheckbackVerify({
        seat: "manager",
        expect: row.expect.slice(0, 100),
        hint: `${outcome.retried ? "re-assigned" : "stale"} (${outcome.reason}); nudge ${parsed?.target ?? "lead"}`,
        cancelCmd: formatCheckbackCancelHint(row.id),
      });
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      workspace: ctx.loaded.workspace,
      });
      if (!r.ok) deferFailedFire(ctx, row, now, r.reason ?? "deliver");
      else row.renewSec = 0;
      ctx.log(`coord-expect ${outcome.retried ? "retry" : "hold"} ${outcome.reason}`);
    } else if (row.kind === "balance-lead-tick") {
      let role = row.recipientLabel?.trim() || "";
      if (!role) {
        try {
          role = loadBalanceVendorContract(contractsDirFor(ctx.loaded)).balance_lead;
        } catch {
          role = "";
        }
      }
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
      const msg = formatRoomCallCheckback(
        row.expect,
        {
          role: meta?.role || row.recipientLabel || "plain",
          slot: meta?.slot,
          mini: meta?.mini,
          ports: meta?.ports,
          workerCount: ctx.loaded.profile.session.workerCount,
          miniMax: ctx.loaded.profile.session.miniMax,
        },
        { id: row.id },
      );
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      workspace: ctx.loaded.workspace,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
      row.renewSec = 0;
      ctx.log(`room-call checkback pane=${pane} expect=${row.expect} (one-shot)`);
    } else if (
      row.expect &&
      (row.kind === "room-comms" || row.expect.startsWith("chat-room:"))
    ) {
      const meta = pane ? paneMetaForPane(pane) : null;
      const parsed = parseRoomCommsExpect(row.expect);
      const selfId = resolveAgentId({
        role: meta?.role || row.recipientLabel || "plain",
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
          role: meta?.role || row.recipientLabel || "plain",
          slot: meta?.slot,
          mini: meta?.mini,
          ports: meta?.ports,
          workerCount: ctx.loaded.profile.session.workerCount,
          miniMax: ctx.loaded.profile.session.miniMax,
        },
        from,
        { verifyOnly: true, id: row.id },
      );
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      workspace: ctx.loaded.workspace,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
      // One verify nudge — do not renew forever (was: cancel-loop fuel).
      row.renewSec = 0;
      ctx.log(`room-comms checkback pane=${pane} expect=${row.expect}`);
    } else {
      const meta = pane ? paneMetaForPane(pane) : null;
      const cbCtx = {
        role: meta?.role || row.recipientLabel || "plain",
        slot: meta?.slot,
        mini: meta?.mini,
        ports: meta?.ports,
        workerCount: ctx.loaded.profile.session.workerCount,
        miniMax: ctx.loaded.profile.session.miniMax,
      };
      const expect = row.expect ?? row.kind;
      const msg = formatGenericCheckback(expect, cbCtx, { id: row.id });
      const r = deliverToPane(pane, msg, ctx.registry, {
        skipVerify: true,
        intent: "checkback-verify",
        loaded: ctx.loaded,
      workspace: ctx.loaded.workspace,
      });
      if (!r.ok) {
        deferFailedFire(ctx, row, now, r.reason ?? "deliver");
        continue;
      }
      // One-shot verify — never renew. Agents chat "Ignored" instead of cancel;
      // renewing that forever is the infinite-ignore loop.
      row.renewSec = 0;
      ctx.log(`checkback pane=${pane} expect=${expect.slice(0, 80)} (one-shot)`);
    }

    if (row.status !== "active") continue;

    if (shouldRenewCheckback(
      { ...row, fireCount: (row.fireCount ?? 0) + 1 },
      now,
      resolveCheckbackMaxFires(ctx.loaded),
    )) {
      row.fireCount = (row.fireCount ?? 0) + 1;
      row.expiresAt = new Date(now + (row.renewSec as number) * 1000).toISOString();
      row.updatedAt = new Date().toISOString();
    } else {
      if (row.renewSec && row.renewSec > 0) {
        ctx.log(
          `checkback auto-stop id=${row.id} kind=${row.kind ?? "?"} fires=${(row.fireCount ?? 0) + 1}`,
        );
      }
      row.status = "cancelled";
      row.updatedAt = new Date().toISOString();
    }
  }
  ctx.store.writeCheckbacks(rows);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const EMPTY_DRAIN_COUNT = { attempted: 0, delivered: 0, held: 0 };

/**
 * One drain-tick step must never starve the rest — in particular, border-paint
 * runs last in this list, so an exception anywhere earlier (inbox/peer/checkback/
 * target/ack draining) used to silently skip painting for that entire tick. See
 * step-isolation.ts for why and the throttled-logging behavior.
 */
const stepErrorLog = createStepErrorLog();
function runStep<T>(ctx: MeshOrchestratorCtx, label: string, fallback: T, fn: () => T): T {
  return stepErrorLog.runStep(label, fallback, fn, ctx.log);
}

export function orchestratorDrainTick(ctx: MeshOrchestratorCtx): DrainTickResult {
  runStep(ctx, "secretary-auto-restart", undefined, () =>
    pollSecretaryAutoRestart({
      loaded: ctx.loaded,
      registry: ctx.registry,
      session: ctx.session,
      baseWindow: ctx.baseWindow,
      log: ctx.log,
    }),
  );
  runStep(ctx, "pane-auto-revive", undefined, () =>
    pollPaneAutoRevive({ loaded: ctx.loaded, registry: ctx.registry, log: ctx.log }),
  );
  runStep(ctx, "layout-auto-scale", undefined, () =>
    pollLayoutAutoScale({ loaded: ctx.loaded, log: ctx.log }),
  );
  if (ctx.paneOps) {
    runStep(ctx, "pane-ops-drain", undefined, () => drainPaneOpsOnce(ctx.paneOps!));
  }
  const a = runStep(ctx, "drain-inbox", EMPTY_DRAIN_COUNT, () => drainInboxOnce(ctx));
  const b = runStep(ctx, "drain-peer", EMPTY_DRAIN_COUNT, () => drainPeerOnce(ctx));
  runStep(ctx, "checkbacks-due", undefined, () => fireDueCheckbacks(ctx));
  runStep(ctx, "targets-due", undefined, () =>
    fireDueTargets({ store: ctx.store, loaded: ctx.loaded, log: ctx.log }),
  );
  runStep(ctx, "ack-sweep", undefined, () => ackSweepTick(ctx));
  runStep(ctx, "border-paint", undefined, () =>
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
    ),
  );
  return {
    attempted: a.attempted + b.attempted,
    delivered: a.delivered + b.delivered,
    held: a.held + b.held,
  };
}

function runStepAsync<T>(
  ctx: MeshOrchestratorCtx,
  label: string,
  fallback: T,
  fn: () => Promise<T> | T,
): Promise<T> {
  return stepErrorLog.runStepAsync(label, fallback, fn, ctx.log);
}

/**
 * Yield between heavy steps so daemon /health can answer during drain. Same
 * per-step isolation as `orchestratorDrainTick` — see `runStep`'s comment.
 */
export async function orchestratorDrainTickAsync(ctx: MeshOrchestratorCtx): Promise<DrainTickResult> {
  await runStepAsync(ctx, "secretary-auto-restart", undefined, () =>
    pollSecretaryAutoRestart({
      loaded: ctx.loaded,
      registry: ctx.registry,
      session: ctx.session,
      baseWindow: ctx.baseWindow,
      log: ctx.log,
    }),
  );
  await runStepAsync(ctx, "pane-auto-revive", undefined, () =>
    pollPaneAutoRevive({ loaded: ctx.loaded, registry: ctx.registry, log: ctx.log }),
  );
  await runStepAsync(ctx, "layout-auto-scale", undefined, () =>
    pollLayoutAutoScale({ loaded: ctx.loaded, log: ctx.log }),
  );
  if (ctx.paneOps) {
    await runStepAsync(ctx, "pane-ops-drain", undefined, () => drainPaneOpsOnce(ctx.paneOps!));
  }
  await yieldEventLoop();
  const a = await runStepAsync(ctx, "drain-inbox", EMPTY_DRAIN_COUNT, () => drainInboxOnce(ctx));
  await yieldEventLoop();
  const b = await runStepAsync(ctx, "drain-peer", EMPTY_DRAIN_COUNT, () => drainPeerOnce(ctx));
  await yieldEventLoop();
  await runStepAsync(ctx, "checkbacks-due", undefined, () => fireDueCheckbacks(ctx));
  await yieldEventLoop();
  await runStepAsync(ctx, "targets-due", undefined, () =>
    fireDueTargets({ store: ctx.store, loaded: ctx.loaded, log: ctx.log }),
  );
  await yieldEventLoop();
  await runStepAsync(ctx, "ack-sweep", undefined, () => ackSweepTick(ctx));
  await yieldEventLoop();
  await runStepAsync(ctx, "border-paint", undefined, () =>
    paintMeshBordersAsync(
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
    ),
  );
  return {
    attempted: a.attempted + b.attempted,
    delivered: a.delivered + b.delivered,
    held: a.held + b.held,
  };
}

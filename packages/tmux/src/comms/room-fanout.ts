import type { LoadedProfile, RoomMessageKind } from "@seat-mesh/core";
import {
  agentIdToSlot,
  chatRoomConfigForLoaded,
  formatRoomCoordNotify,
  formatRoomDirectPm,
  formatRoomPeerNotify,
  isGlobalSlug,
  loadRoomProfile,
  normalizeMinisLeads,
  normalizeRoomAgentId,
  parseMentionAgentIds,
  resolveAgentId,
  buildGlobalRoomAudience,
  resolveFanoutDelivery,
  roomDir,
  unseenSummaryForAgent,
} from "@seat-mesh/core";
import {
  listMeshMonitorPanes,
  meshManagerPane,
  meshSecretaryPane,
  paneMetaForPane,
} from "../lib/pane-meta.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { resolveMiniPaneId } from "../session/window-panes.js";
import { ensureMeshInbox } from "./inbox-bridge.js";
import { deliverPeerMessage } from "./peer-send.js";

export interface RoomFanOutInput {
  slug: string;
  from: string;
  kind: RoomMessageKind;
  body: string;
  senderPane?: string;
  fromPorts?: string | null;
}

export interface RoomFanOutResult {
  sent: number;
  enqueued: number;
  skipped: number;
  failed: number;
}

function peerContextForPane(
  paneId: string,
  loaded: LoadedProfile,
): {
  role: string;
  slot?: string | number | null;
  mini?: string | number | null;
  ports?: string | null;
  workerCount: number;
  miniMax: number;
} {
  const meta = paneMetaForPane(paneId);
  const slotNum = meta?.slot ? Number(meta.slot) : null;
  return {
    role: meta?.role || "worker",
    slot: slotNum && !Number.isNaN(slotNum) ? slotNum : null,
    mini: meta?.mini || null,
    ports: meta?.ports || null,
    workerCount: loaded.profile.session.workerCount,
    miniMax: loaded.profile.session.miniMax,
  };
}

function agentIdForPane(paneId: string): string {
  const meta = paneMetaForPane(paneId);
  if (!meta) return "unknown";
  const slotNum = meta.slot ? Number(meta.slot) : null;
  const mini = meta.mini || (meta.slot.startsWith("mini-") ? meta.slot.slice(5) : null);
  const id = resolveAgentId({
    role: meta.role,
    slot: slotNum && !Number.isNaN(slotNum) ? slotNum : null,
    mini: mini || null,
  });
  return id === "master" ? "manager" : id;
}

/** Manager/secretary/leads first so fan-out cannot stall before coord panes. */
function fanoutTargetOrder(aId: string, bId: string, coords: Set<string>): number {
  const rank = (id: string) => {
    if (id === "manager") return 0;
    if (id === "secretary") return 1;
    if (coords.has(id)) return 2;
    return 3;
  };
  return rank(aId) - rank(bId) || aId.localeCompare(bId);
}

export { normalizeRoomAgentId };

/** Resolve tmux pane for a ledger `from` agent id (not the CLI shell pane). */
export function resolveAgentPaneId(loaded: LoadedProfile, agentId: string): string | null {
  const layout = loaded.profile.layout;
  if (!layout) return null;
  const session = loaded.sessionName;
  const id = normalizeRoomAgentId(agentId);

  if (id === "manager") return meshManagerPane(session, layout.base.window);
  if (id === "secretary") return meshSecretaryPane(session, layout.base.window);

  if (id.startsWith("mini-")) {
    const n = Number.parseInt(id.slice(5), 10);
    if (!Number.isNaN(n)) {
      return resolveMiniPaneId(session, layout.minis.window, n);
    }
  }

  if (id.startsWith("worker-")) {
    const slot = id.slice(7);
    const resolved = resolvePaneTarget(slot, loaded);
    if ("error" in resolved) return null;
    return resolved.paneId;
  }

  return null;
}

/** Contract audience = members + leads + leadWorkers + supervisor + manager + grid mini-leads. */
function contractAudienceSet(loaded: LoadedProfile, slug: string): Set<string> | null {
  const cfg = chatRoomConfigForLoaded(loaded);
  if (isGlobalSlug(cfg, slug)) {
    return buildGlobalRoomAudience(loaded.profile.session.miniMax);
  }
  const profile = loadRoomProfile(roomDir(loaded.workspace, cfg, slug));
  if (!profile?.members?.length) return null;

  const audience = new Set<string>();
  const add = (id: string | undefined | null) => {
    if (!id?.trim()) return;
    audience.add(normalizeRoomAgentId(id));
  };

  for (const m of profile.members) add(m);
  add(profile.lead);
  if (profile.leads?.length) {
    for (const l of profile.leads) add(l);
  }
  if (profile.leadWorkers?.length) {
    for (const w of profile.leadWorkers) add(w);
  }
  add(profile.supervisor);
  audience.add("manager");
  audience.add("manager-2");

  const gridLeads = loaded.profile.layout?.minis?.leads ?? [];
  for (const n of gridLeads) add(`mini-${n}`);

  return audience;
}

/** Manager, secretary, contract leads, grid mini-leads, leadWorkers get rich body pings. */
function coordAudienceSet(loaded: LoadedProfile, slug: string): Set<string> {
  const cfg = chatRoomConfigForLoaded(loaded);
  const out = new Set<string>(["manager", "manager-2", "secretary"]);
  if (isGlobalSlug(cfg, slug)) return out;

  const profile = loadRoomProfile(roomDir(loaded.workspace, cfg, slug));
  if (!profile) return out;

  const add = (id: string | undefined | null) => {
    if (!id?.trim()) return;
    out.add(normalizeRoomAgentId(id));
  };
  add(profile.lead);
  add(profile.supervisor);
  if (profile.leads?.length) {
    for (const l of profile.leads) add(l);
  }
  if (profile.leadWorkers?.length) {
    for (const w of profile.leadWorkers) add(w);
  }
  for (const n of loaded.profile.layout?.minis?.leads ?? []) add(`mini-${n}`);
  return out;
}

function resolveTargetLabel(label: string): string {
  if (label.startsWith("mini-")) return label;
  if (label.startsWith("slot-")) return label.replace(/^slot-/, "");
  return label;
}

/**
 * Room fan-out: 2-member + @mention = harness direct PM (full body).
 * 3+ members = thin ping + unseen count; ledger is truth.
 */
export function fanOutRoomMessage(
  loaded: LoadedProfile,
  input: RoomFanOutInput,
): RoomFanOutResult {
  const layout = loaded.profile.layout;
  if (!layout) return { sent: 0, enqueued: 0, skipped: 0, failed: 0 };

  const session = loaded.sessionName;
  const cfg = chatRoomConfigForLoaded(loaded);
  const all = listMeshMonitorPanes(
    session,
    layout.base.window,
    layout.workers.window,
    layout.minis.window,
  );
  const members = contractAudienceSet(loaded, input.slug);
  const coords = coordAudienceSet(loaded, input.slug);
  const roomProfile =
    members && !isGlobalSlug(cfg, input.slug)
      ? loadRoomProfile(roomDir(loaded.workspace, cfg, input.slug))
      : null;
  const memberCount = members?.size ?? 0;
  const miniLayout = layout.minis;
  const miniGridOpts = miniLayout
    ? {
        miniGrid: miniLayout.grid,
        miniMax: miniLayout.max,
        miniLeads: normalizeMinisLeads(miniLayout.leads),
      }
    : {};
  const mentions = parseMentionAgentIds(input.body);
  const fromSlot = agentIdToSlot(input.from) ?? "?";
  const senderMeta = input.senderPane ? paneMetaForPane(input.senderPane) : null;
  const fromPorts = input.fromPorts ?? senderMeta?.ports ?? "?";

  // Exclude the sender's own pane by ledger `from`, not the CLI shell TMUX_PANE
  // (manager often runs `room say --from secretary` from the manager pane).
  const senderAgentPane = resolveAgentPaneId(loaded, input.from);
  const excludePane = senderAgentPane ?? input.senderPane;

  const targets = all
    .filter((t) => {
      if (excludePane && t.paneId === excludePane) return false;
      if (!members) return true;
      return members.has(agentIdForPane(t.paneId));
    })
    .sort(
      (a, b) =>
        fanoutTargetOrder(agentIdForPane(a.paneId), agentIdForPane(b.paneId), coords),
    );

  const targetPaneIds = new Set(targets.map((t) => t.paneId));
  for (const mid of mentions) {
    if (members?.has(mid)) continue;
    const pane = resolveAgentPaneId(loaded, mid);
    if (!pane || targetPaneIds.has(pane) || (excludePane && pane === excludePane)) continue;
    const extra = all.find((t) => t.paneId === pane);
    if (extra) {
      targets.push(extra);
      targetPaneIds.add(pane);
    }
  }

  let skipped = all.length - targets.length;

  ensureMeshInbox(loaded, { quiet: true });

  let sent = 0;
  let enqueued = 0;
  let failed = 0;

  for (const t of targets) {
    const agentId = agentIdForPane(t.paneId);
    const ctx = peerContextForPane(t.paneId, loaded);
    const mentioned = mentions.includes(agentId);
    const directPm = mentioned || memberCount === 2;

    let delivery: "rich" | "thin" | "skip" = "thin";
    if (directPm) {
      delivery = "rich";
    } else if (roomProfile) {
      delivery = resolveFanoutDelivery({
        targetId: agentId,
        from: input.from,
        kind: input.kind,
        body: input.body,
        profile: roomProfile,
        ...miniGridOpts,
      });
    } else if (coords.has(agentId)) {
      delivery = "rich";
    } else {
      delivery = "thin";
    }
    if (delivery === "skip") {
      skipped++;
      continue;
    }

    const unseen = unseenSummaryForAgent(loaded.workspace, cfg, input.slug, agentId);
    const msg = directPm
      ? formatRoomDirectPm(input.slug, input.from, fromSlot, fromPorts, input.body, ctx)
      : delivery === "rich"
        ? formatRoomCoordNotify(input.slug, input.kind, input.from, input.body, ctx, { unseen })
        : formatRoomPeerNotify(input.slug, input.kind, input.from, input.body, ctx, { unseen });

    const result = deliverPeerMessage(
      loaded,
      resolveTargetLabel(t.label),
      t.paneId,
      t.label,
      msg,
      fromSlot,
      fromPorts,
      {
        roomSlug: input.slug,
        fromAgent: input.from,
        queueOnly: true,
        skipEnsure: true,
      },
    );
    if (result === "sent") sent++;
    else if (result === "queued") enqueued++;
    else failed++;
  }

  return { sent, enqueued, skipped, failed };
}

import type { LoadedProfile } from "seat-mesh-core";
import { formatToSlotReplyCmd, portsForSlot } from "seat-mesh-core";
import { createRegistryForProfile } from "seat-mesh-providers";
import { enqueuePeer } from "./inbox-bridge.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { runWhoami } from "../agents/whoami.js";
import {
  harnessToSlotMessage,
  tryDirectPeerInject,
} from "../inject/direct-peer.js";
import { armAfterToSlot, armRecipientRoomPing, armRecipientToSlot } from "./chat-checkback.js";

function requireWorkerSender(loaded: LoadedProfile): {
  slot: string;
  ports: string;
} {
  if (!process.env.TMUX_PANE) {
    throw new Error("refused: run from a worker tmux pane");
  }
  const who = runWhoami(loaded, "here");
  if (who.role === "manager" || who.role === "secretary" || who.role === "manager-mini") {
    throw new Error(`refused: ${who.role} cannot use peer send (use prompt / mini peer)`);
  }
  if (who.role !== "worker" || who.slot == null) {
    throw new Error(`refused: @mesh_role is '${who.role}' (want worker)`);
  }
  const slot = String(who.slot);
  if (who.slot < 1 || who.slot > loaded.profile.session.workerCount) {
    throw new Error(`refused: bad worker slot '${slot}'`);
  }
  const ports = who.ports ?? portsForSlot(loaded.profile.ports.worker, who.slot);
  return { slot, ports };
}

function formatToMiniMsg(fromSlot: string, fromPorts: string, miniId: string, report: string): string {
  const text = report.trim();
  return `[agent-worker-slot-${fromSlot}] TO-MINI-${miniId} (${fromPorts}): ${text} — reply ${formatToSlotReplyCmd(fromSlot)}`;
}

function deliverPeer(
  loaded: LoadedProfile,
  resolveTarget: string,
  targetLabel: string,
  targetPane: string,
  msg: string,
  enqueue: {
    kind: "to-slot" | "to-mini";
    fromSlot: string;
    fromPorts: string;
  },
): void {
  const registry = createRegistryForProfile(loaded.profile);
  const direct = tryDirectPeerInject(registry, loaded, resolveTarget, msg);
  if (direct.ok) {
    console.log(`sent -> ${targetLabel} from slot-${enqueue.fromSlot}`);
    armRecipientToSlot(loaded, targetPane, enqueue.fromSlot);
    return;
  }
  const resp = enqueuePeer(loaded, {
    kind: enqueue.kind,
    fromSlot: enqueue.fromSlot,
    fromPorts: enqueue.fromPorts,
    targetPane,
    targetLabel,
    msg,
  });
  if (!resp?.ok) {
    throw new Error("FAIL: peer enqueue (inbox down?) — run: ./sm.sh inbox restart");
  }
  console.log(`queued -> ${targetLabel} from slot-${enqueue.fromSlot} (${direct.reason})`);
}

/** Direct PM when idle (harness to-slot); queue when busy. */
export function runToSlot(loaded: LoadedProfile, destSlot: string, report: string): void {
  const { slot, ports } = requireWorkerSender(loaded);
  const dest = destSlot.replace(/^slot-/, "");
  if (!/^[1-8]$/.test(dest)) {
    throw new Error("usage: to-slot <1-8> <msg...>");
  }
  if (dest === slot) {
    throw new Error(`refused: cannot to-slot yourself (slot-${slot})`);
  }
  if (!report.trim()) {
    throw new Error("usage: to-slot <1-8> <msg...>");
  }

  const resolved = resolvePaneTarget(dest, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const msg = harnessToSlotMessage(slot, ports, dest, report);
  deliverPeer(loaded, dest, `slot-${dest}`, resolved.paneId, msg, {
    kind: "to-slot",
    fromSlot: slot,
    fromPorts: ports,
  });
  armAfterToSlot(loaded, slot, { pane: process.env.TMUX_PANE, slot });
}

export function runToMini(loaded: LoadedProfile, miniId: string, report: string): void {
  const { slot, ports } = requireWorkerSender(loaded);
  const mid = miniId.replace(/^mini-/, "");
  const max = loaded.profile.session.miniMax;
  if (!/^[1-9]$/.test(mid) || Number(mid) > max) {
    throw new Error(`usage: to-mini <1-${max}> <msg...>`);
  }
  if (!report.trim()) {
    throw new Error(`usage: to-mini <1-${max}> <msg...>`);
  }

  const resolved = resolvePaneTarget(`mini-${mid}`, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const msg = formatToMiniMsg(slot, ports, mid, report);
  deliverPeer(loaded, `mini-${mid}`, `mini-${mid}`, resolved.paneId, msg, {
    kind: "to-mini",
    fromSlot: slot,
    fromPorts: ports,
  });
  armAfterToSlot(loaded, slot, { pane: process.env.TMUX_PANE, slot });
}

/** Exported for room fan-out (@mentions, 2-member direct PM). */
export interface DeliverPeerOpts {
  fromAgent?: string;
  roomSlug?: string;
  /** Room fan-out: always enqueue (daemon injects with roomPing bypass). Avoids sync inject hang. */
  queueOnly?: boolean;
  /** Fan-out batch: caller already ran ensureMeshInbox once. */
  skipEnsure?: boolean;
}

export function deliverPeerMessage(
  loaded: LoadedProfile,
  resolveTarget: string,
  targetPane: string,
  targetLabel: string,
  msg: string,
  fromSlot: string,
  fromPorts: string | null,
  opts: DeliverPeerOpts = {},
): "sent" | "queued" | "failed" {
  if (!opts.queueOnly) {
    const registry = createRegistryForProfile(loaded.profile);
    const direct = tryDirectPeerInject(registry, loaded, resolveTarget, msg);
    if (direct.ok) {
      if (opts.roomSlug) {
        armRecipientRoomPing(
          loaded,
          targetPane,
          opts.roomSlug,
          opts.fromAgent ?? `worker-${fromSlot}`,
        );
      } else {
        armRecipientToSlot(loaded, targetPane, fromSlot);
      }
      return "sent";
    }
  }

  const resp = enqueuePeer(loaded, {
    kind: opts.roomSlug ? "room" : "to-slot",
    fromSlot,
    fromPorts,
    roomSlug: opts.roomSlug ?? null,
    fromAgent: opts.fromAgent ?? null,
    targetPane,
    targetLabel,
    msg,
    skipEnsure: opts.skipEnsure,
  });
  return resp?.ok ? "queued" : "failed";
}

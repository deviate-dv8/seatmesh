import type { LoadedProfile } from "@seat-mesh/core";
import { formatPeerReplyCmd, isCoordKind, portsForSlot } from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { enqueuePeer } from "./inbox-bridge.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { runWhoami } from "../agents/whoami.js";
import {
  harnessToSlotMessage,
  tryDirectPeerInject,
} from "../inject/direct-peer.js";
import { bypassPeerDeliver, isInboxUp } from "./bypass-comms.js";
import { enqueuePrompt } from "../inject/prompt.js";
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
    throw new Error(`refused: ${who.role} cannot use to-slot/to-mini (use: peer <target>)`);
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
  // Seamless mesh: one reply cmd for every role (minis cannot run to-slot).
  return `[agent-worker-slot-${fromSlot}] TO-MINI-${miniId} (${fromPorts}): ${text} — reply ${formatPeerReplyCmd(`slot-${fromSlot}`)}`;
}

function formatMiniToSlotMsg(fromMini: string, fromPorts: string, destSlot: string, report: string): string {
  const text = report.trim();
  return `[agent-mini-${fromMini}] TO-SLOT-${destSlot} (${fromPorts}): ${text} — reply ${formatPeerReplyCmd(`mini-${fromMini}`)}`;
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
  const inboxUp = isInboxUp(loaded);

  if (!inboxUp) {
    const bypass = bypassPeerDeliver(
      registry,
      loaded,
      resolveTarget,
      targetLabel,
      msg,
      `from ${enqueue.fromSlot}`,
    );
    if (!bypass.ok) {
      throw new Error(
        `FAIL: bypass peer -> ${targetLabel} (${bypass.reason ?? "?"}) — launch CLI or fix inbox`,
      );
    }
    console.log(`bypass sent -> ${targetLabel} from ${enqueue.fromSlot} mode=${bypass.mode ?? "?"}`);
    armRecipientToSlot(loaded, targetPane, enqueue.fromSlot);
    return;
  }

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
    const bypass = bypassPeerDeliver(
      registry,
      loaded,
      resolveTarget,
      targetLabel,
      msg,
      "enqueue failed",
    );
    if (!bypass.ok) {
      throw new Error(
        `FAIL: peer enqueue and bypass failed -> ${targetLabel} (${bypass.reason ?? "?"})`,
      );
    }
    console.log(`bypass sent -> ${targetLabel} from ${enqueue.fromSlot} mode=${bypass.mode ?? "?"}`);
    armRecipientToSlot(loaded, targetPane, enqueue.fromSlot);
    return;
  }
  console.log(`queued -> ${targetLabel} from slot-${enqueue.fromSlot} (${direct.reason})`);
}

/**
 * Universal peer — workers, minis, and coords all use `peer <target>`.
 * Workers still may call to-slot / to-mini; those stay as thin aliases.
 * Coord `--direct` stays in the CLI (injectPromptDirect).
 */
export function runPeer(
  loaded: LoadedProfile,
  targetRaw: string,
  report: string,
): { via: string; paneId?: string; targetLabel: string; token?: string } {
  const text = report.trim();
  if (!targetRaw?.trim() || !text) {
    throw new Error(
      'usage: peer <manager|secretary|slot-N|mini-N|pane> <msg...>',
    );
  }
  if (!process.env.TMUX_PANE) {
    throw new Error("refused: run peer from a live mesh pane");
  }

  const who = runWhoami(loaded, "here");
  const target = targetRaw.trim();
  const kinds = loaded.profile.layout?.base.kinds;

  if (who.role === "worker" && who.slot != null) {
    const slotDest = target.match(/^slot-([1-9])$/i)?.[1];
    if (slotDest) {
      runToSlot(loaded, slotDest, text);
      return { via: "to-slot", targetLabel: `slot-${slotDest}` };
    }
    const miniDest = target.match(/^(?:mini|manager-mini)-([1-9]\d*)$/i)?.[1];
    if (miniDest) {
      runToMini(loaded, miniDest, text);
      return { via: "to-mini", targetLabel: `mini-${miniDest}` };
    }
    // worker -> manager/secretary/coord (FYI/PROG skips checkback arm inside enqueue)
    const sent = enqueuePrompt(loaded, target, text, {
      manager: false,
      prefix: "",
    });
    const line =
      sent.via === "bypass"
        ? `BYPASS: peer -> ${sent.targetLabel} pane=${sent.paneId} (direct inject, not in history)`
        : sent.via === "queued"
          ? `QUEUED: peer -> ${sent.targetLabel} pane=${sent.paneId} token=${sent.token ?? "-"} (inbox inject when idle)`
          : `SENT: peer -> ${sent.targetLabel} pane=${sent.paneId} token=${sent.token ?? "-"} via=${sent.via ?? "pane-row"}`;
    console.log(line);
    return {
      via: sent.via ?? "queued",
      paneId: sent.paneId,
      targetLabel: sent.targetLabel,
      token: sent.token,
    };
  }

  if (who.role === "manager-mini") {
    const selfMini =
      who.slotLabel?.replace(/^(?:mini|manager-mini)-/i, "") ||
      (who.ports?.match(/mini-(\d+)/i)?.[1] ?? "");
    const slotDest = target.match(/^slot-([1-9]\d*)$/i)?.[1];
    if (slotDest) {
      runMiniToSlot(loaded, slotDest, text, selfMini);
      return { via: "to-slot", targetLabel: `slot-${slotDest}` };
    }
    const destMini = target.match(/^(?:mini|manager-mini)-([1-9]\d*)$/i)?.[1];
    if (destMini && selfMini && destMini === selfMini) {
      throw new Error(`refused: cannot peer yourself (mini-${selfMini})`);
    }
    const sent = enqueuePrompt(loaded, target, text, {
      manager: false,
      prefix: "",
    });
    const line =
      sent.via === "bypass"
        ? `BYPASS: peer -> ${sent.targetLabel} pane=${sent.paneId} (direct inject, not in history)`
        : sent.via === "queued"
          ? `QUEUED: peer -> ${sent.targetLabel} pane=${sent.paneId} token=${sent.token ?? "-"} (inbox inject when idle)`
          : `SENT: peer -> ${sent.targetLabel} pane=${sent.paneId} token=${sent.token ?? "-"} via=${sent.via ?? "pane-row"}`;
    console.log(line);
    return {
      via: sent.via ?? "queued",
      paneId: sent.paneId,
      targetLabel: sent.targetLabel,
      token: sent.token,
    };
  }

  if (!isCoordKind(who.role, kinds)) {
    throw new Error(
      `refused: peer requires worker|manager-mini|manager|secretary (you_are=${who.role})`,
    );
  }

  // Coord path stays in CLI (manager prefix / --direct).
  throw new Error("__peer_coord__");
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

function requireMiniSender(loaded: LoadedProfile, selfMiniHint?: string): {
  mini: string;
  ports: string;
} {
  const who = runWhoami(loaded, "here");
  if (who.role !== "manager-mini") {
    throw new Error(`refused: @mesh_role is '${who.role}' (want manager-mini)`);
  }
  const mini =
    selfMiniHint ??
    who.slotLabel?.replace(/^(?:mini|manager-mini)-/i, "") ??
    who.ports?.match(/mini-(\d+)/i)?.[1] ??
    "";
  if (!mini) throw new Error("refused: mini pane missing @mesh_mini label");
  const ports = who.ports ?? `mini-${mini}`;
  return { mini, ports };
}

/** Mini -> worker direct PM when idle; queue when busy. */
export function runMiniToSlot(
  loaded: LoadedProfile,
  destSlot: string,
  report: string,
  selfMiniHint?: string,
): void {
  const { mini, ports } = requireMiniSender(loaded, selfMiniHint);
  const dest = destSlot.replace(/^slot-/, "");
  const max = loaded.profile.session.workerCount;
  if (!/^[1-9]\d*$/.test(dest) || Number(dest) < 1 || Number(dest) > max) {
    throw new Error(`usage: peer slot-<1-${max}> <msg...>   (from mini pane)`);
  }
  if (!report.trim()) {
    throw new Error(`usage: peer slot-<1-${max}> <msg...>`);
  }

  const resolved = resolvePaneTarget(dest, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const msg = formatMiniToSlotMsg(mini, ports, dest, report);
  deliverPeer(loaded, dest, `slot-${dest}`, resolved.paneId, msg, {
    kind: "to-slot",
    fromSlot: `mini-${mini}`,
    fromPorts: ports,
  });
  armAfterToSlot(loaded, mini, { pane: process.env.TMUX_PANE, slot: mini });
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
  /**
   * When queue/enqueue fails, do NOT fall back to direct inject.
   * Room broadcast uses this so a busy/down inbox does not spam
   * "direct inject only" across every pane.
   */
  noBypass?: boolean;
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
  const registry = createRegistryForProfile(loaded.profile);
  const inboxUp = isInboxUp(loaded);
  const noBypass = opts.noBypass === true || opts.queueOnly === true;

  if (!inboxUp) {
    if (noBypass) return "failed";
    const bypass = bypassPeerDeliver(
      registry,
      loaded,
      resolveTarget,
      targetLabel,
      msg,
      opts.roomSlug ? `room ${opts.roomSlug}` : undefined,
    );
    if (!bypass.ok) return "failed";
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

  if (!opts.queueOnly) {
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
  if (resp?.ok) return "queued";

  if (noBypass) return "failed";

  const bypass = bypassPeerDeliver(registry, loaded, resolveTarget, targetLabel, msg, "enqueue failed");
  if (!bypass.ok) return "failed";
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

import type { LoadedProfile } from "seat-mesh-core";
import {
  chatRoomConfigForLoaded,
  createPendingCall,
  createRoom,
  findCallByShortId,
  formatRoomCallInvite,
  formatRoomCallResolved,
  listPendingCallsForAgent,
  portsForSlot,
  resolveAgentId,
  sayInRoom,
  updateCall,
} from "seat-mesh-core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { runWhoami } from "../agents/whoami.js";
import { paneMetaForPane } from "../lib/pane-meta.js";
import { enqueuePeer } from "./inbox-bridge.js";
import { fanOutRoomMessage } from "./room-fanout.js";
import {
  armAfterRoomCall,
  armRecipientRoomCall,
  armRecipientRoomPing,
  armSenderChatCheckback,
} from "./chat-checkback.js";
import { expectRoomPeerReply } from "seat-mesh-core";

function requireWorker(loaded: LoadedProfile): {
  slot: string;
  ports: string;
  agentId: string;
  paneId: string;
} {
  if (!process.env.TMUX_PANE) {
    throw new Error("refused: run from a worker tmux pane");
  }
  const who = runWhoami(loaded, "here");
  if (who.role !== "worker" || who.slot == null) {
    throw new Error(`refused: ${who.role} cannot room call (workers only)`);
  }
  const slot = String(who.slot);
  const ports = who.ports ?? portsForSlot(loaded.profile.ports.worker, who.slot);
  const agentId = resolveAgentId({ role: "worker", slot: who.slot });
  const paneId = who.paneId ?? process.env.TMUX_PANE;
  if (!paneId) throw new Error("refused: no tmux pane");
  return { slot, ports, agentId, paneId };
}

function peerContextForPane(paneId: string, loaded: LoadedProfile) {
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

function enqueueThinPeer(
  loaded: LoadedProfile,
  opts: {
    msg: string;
    targetPane: string;
    targetLabel: string;
    fromSlot: string;
    fromPorts: string | null;
  },
): void {
  const resp = enqueuePeer(loaded, {
    kind: "to-slot",
    fromSlot: opts.fromSlot,
    fromPorts: opts.fromPorts,
    targetPane: opts.targetPane,
    targetLabel: opts.targetLabel,
    msg: opts.msg,
  });
  if (!resp?.ok) {
    throw new Error("FAIL: peer enqueue (inbox down?) — run: ./sm.sh inbox restart");
  }
}

/** Worker initiates a room contract with another worker (call / accept / decline). */
export function runRoomCall(loaded: LoadedProfile, destSlot: string, topic: string): void {
  const caller = requireWorker(loaded);
  const dest = destSlot.replace(/^slot-/, "");
  if (!/^[1-9]$/.test(dest)) {
    throw new Error("usage: room call <slot-N|N> <topic...>");
  }
  if (dest === caller.slot) {
    throw new Error("refused: cannot call yourself");
  }
  if (!topic.trim()) {
    throw new Error("usage: room call <slot-N|N> <topic...>");
  }

  const session = loaded.sessionName;
  const resolved = resolvePaneTarget(dest, loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const calleeAgent = resolveAgentId({ role: "worker", slot: Number(dest) });
  const call = createPendingCall(loaded, {
    fromAgent: caller.agentId,
    toAgent: calleeAgent,
    fromSlot: caller.slot,
    toSlot: dest,
    topic: topic.trim(),
  });

  const invite = formatRoomCallInvite(call.shortId, caller.agentId, call.topic, {
    role: "worker",
    slot: Number(dest),
    ports: paneMetaForPane(resolved.paneId)?.ports,
    workerCount: loaded.profile.session.workerCount,
  });

  enqueueThinPeer(loaded, {
    msg: invite,
    targetPane: resolved.paneId,
    targetLabel: `slot-${dest}`,
    fromSlot: caller.slot,
    fromPorts: caller.ports,
  });
  armRecipientRoomCall(loaded, resolved.paneId, call.shortId);

  armAfterRoomCall(loaded, call.shortId, caller.paneId);

  console.log(
    `ok call=${call.shortId} room=${call.roomSlug} -> ${calleeAgent} (wait: accept|decline)`,
  );
}

export async function runRoomAccept(loaded: LoadedProfile, callId: string): Promise<void> {
  const callee = requireWorker(loaded);
  const call = findCallByShortId(loaded, callId);
  if (!call) throw new Error(`call not found: ${callId}`);
  if (call.status !== "pending") {
    throw new Error(`call ${call.shortId} is ${call.status} (not pending)`);
  }
  if (call.toAgent !== callee.agentId) {
    throw new Error(`refused: call ${call.shortId} is for ${call.toAgent}, not ${callee.agentId}`);
  }

  const cfg = chatRoomConfigForLoaded(loaded);
  createRoom({
    workspace: loaded.workspace,
    cfg,
    slug: call.roomSlug,
    createdBy: callee.agentId,
    scope: call.topic,
    members: [call.fromAgent, call.toAgent],
  });

  const connected = await sayInRoom(
    loaded.workspace,
    cfg,
    call.roomSlug,
    callee.agentId,
    `CONNECTED: ${call.fromAgent} + ${call.toAgent} — ${call.topic}`,
    {
      kind: "fyi",
      armCheckback: false,
      ownerPane: callee.paneId,
      senderPane: callee.paneId,
      ownerSlot: callee.slot,
    },
  );

  fanOutRoomMessage(loaded, {
    slug: call.roomSlug,
    from: connected.message.from,
    kind: connected.message.kind,
    body: connected.message.body,
    senderPane: callee.paneId,
  });

  call.status = "accepted";
  call.resolvedAt = new Date().toISOString();
  updateCall(loaded, call);

  const session = loaded.sessionName;
  const callerResolved = resolvePaneTarget(call.fromSlot, loaded);
  if (!("error" in callerResolved)) {
    const notify = formatRoomCallResolved(
      "accepted",
      callee.agentId,
      call.roomSlug,
      call.shortId,
      undefined,
      peerContextForPane(callerResolved.paneId, loaded),
    );
    enqueueThinPeer(loaded, {
      msg: notify,
      targetPane: callerResolved.paneId,
      targetLabel: `slot-${call.fromSlot}`,
      fromSlot: callee.slot,
      fromPorts: callee.ports,
    });
    armRecipientRoomPing(
      loaded,
      callerResolved.paneId,
      call.roomSlug,
      callee.agentId,
    );
  }

  armSenderChatCheckback(loaded, expectRoomPeerReply(call.roomSlug), {
    pane: callee.paneId,
    slot: callee.slot,
    kind: "room-comms",
  });

  console.log(`ok accepted call=${call.shortId} room=${call.roomSlug}`);
  console.log(`comms: ./sm.sh room tail -r ${call.roomSlug} -n 10`);
}

export function runRoomDecline(
  loaded: LoadedProfile,
  callId: string,
  reason?: string,
): void {
  const callee = requireWorker(loaded);
  const call = findCallByShortId(loaded, callId);
  if (!call) throw new Error(`call not found: ${callId}`);
  if (call.status !== "pending") {
    throw new Error(`call ${call.shortId} is ${call.status} (not pending)`);
  }
  if (call.toAgent !== callee.agentId) {
    throw new Error(`refused: call ${call.shortId} is for ${call.toAgent}, not ${callee.agentId}`);
  }

  call.status = "declined";
  call.resolvedAt = new Date().toISOString();
  call.declineReason = reason?.trim() || undefined;
  updateCall(loaded, call);

  const session = loaded.sessionName;
  const callerResolved = resolvePaneTarget(call.fromSlot, loaded);
  if (!("error" in callerResolved)) {
    const notify = formatRoomCallResolved(
      "declined",
      callee.agentId,
      null,
      call.shortId,
      reason,
      peerContextForPane(callerResolved.paneId, loaded),
    );
    enqueueThinPeer(loaded, {
      msg: notify,
      targetPane: callerResolved.paneId,
      targetLabel: `slot-${call.fromSlot}`,
      fromSlot: callee.slot,
      fromPorts: callee.ports,
    });
  }

  console.log(`ok declined call=${call.shortId}`);
}

export function runRoomCallsList(loaded: LoadedProfile): void {
  const who = runWhoami(loaded, "here");
  const mini =
    paneMetaForPane(who.paneId ?? "")?.mini ||
    (who.slotLabel?.startsWith("mini-") ? who.slotLabel.replace(/^mini-/, "") : null);
  const agentId = resolveAgentId({
    role: who.role,
    slot: who.slot,
    mini: mini || null,
  });
  const rows = listPendingCallsForAgent(loaded, agentId);
  if (!rows.length) {
    console.log("no pending calls");
    return;
  }
  for (const r of rows) {
    const dir = r.fromAgent === agentId ? "outgoing" : "incoming";
    console.log(
      `${r.shortId}\t${dir}\t${r.fromAgent}->${r.toAgent}\troom=${r.roomSlug}\t${r.topic.slice(0, 80)}`,
    );
  }
}

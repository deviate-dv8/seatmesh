import {
  chatRoomConfigForLoaded,
  checkbackTimingForExpect,
  expectPeerSlotReply,
  expectRoomCallPending,
  expectRoomPeerReply,
  parseDurationToSeconds,
} from "@seat-mesh/core";
import type { LoadedProfile } from "@seat-mesh/core";
import type { CheckbackRow, QueueStore, PeerRow } from "./create-queue-store.js";

function expiresIn(duration: string, fallbackSec = 300): string {
  const sec = parseDurationToSeconds(duration) ?? fallbackSec;
  return new Date(Date.now() + sec * 1000).toISOString();
}

function expectForPeerRow(row: PeerRow): string | null {
  const callMatch = row.msg.match(/\.\/sm\.sh room accept ([^\s]+)/);
  if (callMatch?.[1]) return expectRoomCallPending(callMatch[1]);

  const tailMatch = row.msg.match(/\.\/sm\.sh room tail -r ([^\s]+)/);
  if (tailMatch?.[1] && /\[mesh-peer\] ACCEPTED/i.test(row.msg)) {
    return expectRoomPeerReply(tailMatch[1]);
  }

  if (row.kind === "room" && row.roomSlug) {
    const from = row.fromAgent ?? `worker-${row.fromSlot}`;
    return `${expectRoomPeerReply(row.roomSlug)} from ${from}`;
  }
  if (row.kind === "to-slot" || row.kind === "to-mini") {
    return expectPeerSlotReply(row.fromSlot);
  }
  return null;
}

/** Arm poll-later on recipient after PEER inject (queued path). */
export function armRecipientCheckbackAfterPeer(
  store: QueueStore,
  loaded: LoadedProfile,
  row: PeerRow,
): void {
  if (row.kind !== "room" && row.kind !== "to-slot" && row.kind !== "to-mini") return;
  const expect = expectForPeerRow(row);
  if (!expect) return;

  const dup = store
    .readCheckbacks()
    .some(
      (r) =>
        r.status === "active" &&
        r.ownerPane === row.targetPane &&
        r.expect === expect &&
        Date.parse(r.expiresAt ?? "") > Date.now(),
    );
  if (dup) return;

  const cfg = chatRoomConfigForLoaded(loaded);
  const timing = checkbackTimingForExpect(cfg, expect);
  const renew = parseDurationToSeconds(timing.renew) ?? (expect.startsWith("room-call:") ? 60 : 180);
  const now = new Date().toISOString();
  const cb: CheckbackRow = {
    id: `cb-peer-${Date.now()}-${row.id.slice(0, 8)}`,
    kind: expect.startsWith("room-call:") ? "room-call" : "peer-comms",
    status: "active",
    renewSec: renew,
    expect,
    ownerPane: row.targetPane,
    expiresAt: expiresIn(timing.duration, expect.startsWith("room-call:") ? 60 : 300),
    recipientLabel: row.targetLabel,
    senderLabel: row.fromSlot,
    createdAt: now,
    updatedAt: now,
  };
  store.upsertCheckback(cb);
}

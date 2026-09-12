import {
  armCommsCheckback,
  chatRoomConfigForLoaded,
  expectPeerSlotReply,
  expectRoomCallPending,
  expectRoomCallResolved,
  expectRoomPeerReply,
} from "seat-mesh-core";
import type { LoadedProfile } from "seat-mesh-core";
import { runWhoami } from "../agents/whoami.js";

function ownerPane(loaded: LoadedProfile, explicit?: string): string | undefined {
  return explicit ?? process.env.TMUX_PANE ?? runWhoami(loaded, "here").paneId ?? undefined;
}

/** Arm sender checkback after outbound chat (default on; skip with --no-checkback). */
export function armSenderChatCheckback(
  loaded: LoadedProfile,
  expect: string,
  opts: { pane?: string; slot?: string | number | null; kind?: string } = {},
): void {
  const pane = ownerPane(loaded, opts.pane);
  if (!pane) return;
  const cfg = chatRoomConfigForLoaded(loaded);
  void armCommsCheckback({
    cfg,
    ownerPane: pane,
    expect,
    kind: opts.kind ?? "comms",
    ownerSlot: opts.slot ?? null,
    senderPane: pane,
  }).then((res) => {
    if (res.ok) {
      console.log("checkback: armed");
    } else if (!res.skipped) {
      console.log(`checkback: ${res.reason ?? "failed"}`);
    }
  });
}

/** Arm recipient checkback after inbound peer/room inject (direct or queued). */
export function armRecipientChatCheckback(
  loaded: LoadedProfile,
  targetPane: string,
  expect: string,
): void {
  const cfg = chatRoomConfigForLoaded(loaded);
  void armCommsCheckback({
    cfg,
    ownerPane: targetPane,
    expect,
    kind: "peer-comms",
    senderPane: targetPane,
  });
}

export function armAfterToSlot(
  loaded: LoadedProfile,
  fromSlot: string,
  opts: { pane?: string; slot?: string } = {},
): void {
  armSenderChatCheckback(loaded, expectPeerSlotReply(fromSlot), {
    pane: opts.pane,
    slot: opts.slot,
    kind: "peer-send",
  });
}

export function armAfterRoomSay(
  loaded: LoadedProfile,
  slug: string,
  kind: string,
  opts: { pane?: string; slot?: string | number | null } = {},
): void {
  armSenderChatCheckback(loaded, `chat-room:${slug} peer update (${kind})`, {
    pane: opts.pane,
    slot: opts.slot,
    kind: "room-comms",
  });
}

export function armAfterRoomCall(loaded: LoadedProfile, shortId: string, pane?: string): void {
  armSenderChatCheckback(loaded, expectRoomCallResolved(shortId), {
    pane,
    kind: "room-call",
  });
}

export function armRecipientRoomPing(
  loaded: LoadedProfile,
  targetPane: string,
  slug: string,
  fromAgent: string,
): void {
  armRecipientChatCheckback(loaded, targetPane, `${expectRoomPeerReply(slug)} from ${fromAgent}`);
}

export function armRecipientToSlot(
  loaded: LoadedProfile,
  targetPane: string,
  fromSlot: string,
): void {
  armRecipientChatCheckback(loaded, targetPane, expectPeerSlotReply(fromSlot));
}

export function armRecipientRoomCall(
  loaded: LoadedProfile,
  targetPane: string,
  callShortId: string,
): void {
  armRecipientChatCheckback(loaded, targetPane, expectRoomCallPending(callShortId));
}

import type { ChatRoomConfig } from "./room.js";
import { armCheckback, armCheckbackSync, type ArmCheckbackResult } from "./inbox-client.js";

export interface ArmCommsCheckbackInput {
  cfg: ChatRoomConfig;
  ownerPane: string;
  expect: string;
  kind?: string;
  ownerSlot?: string | number | null;
  ownerMini?: string | number | null;
  senderPane?: string;
  duration?: string;
  renew?: string;
}

export function isRoomCallExpect(expect: string): boolean {
  return expect.startsWith("room-call:");
}

export function checkbackTimingForExpect(
  cfg: ChatRoomConfig,
  expect: string,
): { duration: string; renew: string } {
  if (isRoomCallExpect(expect)) {
    return {
      duration: cfg.checkbackCallPendingDuration,
      renew: cfg.checkbackCallPendingRenew,
    };
  }
  return { duration: cfg.checkbackDuration, renew: cfg.checkbackRenew };
}

/** Default poll-later on every comms send/receive (patience / checkback). */
export async function armCommsCheckback(
  input: ArmCommsCheckbackInput,
): Promise<ArmCheckbackResult> {
  const timing = checkbackTimingForExpect(input.cfg, input.expect);
  return armCheckback({
    inboxBase: input.cfg.inboxBase,
    ownerPane: input.ownerPane,
    expect: input.expect,
    duration: input.duration ?? timing.duration,
    renew: input.renew ?? timing.renew,
    kind: input.kind ?? "comms",
    senderPane: input.senderPane ?? input.ownerPane,
    ownerSlot: input.ownerSlot,
    ownerMini: input.ownerMini,
  });
}

/** Blocking arm for CLI send (peer/assign/to-slot) — default 5m / renew 3m from profile. */
export function armCommsCheckbackSync(input: ArmCommsCheckbackInput): ArmCheckbackResult {
  const timing = checkbackTimingForExpect(input.cfg, input.expect);
  return armCheckbackSync({
    inboxBase: input.cfg.inboxBase,
    ownerPane: input.ownerPane,
    expect: input.expect,
    duration: input.duration ?? timing.duration,
    renew: input.renew ?? timing.renew,
    kind: input.kind ?? "comms",
    senderPane: input.senderPane ?? input.ownerPane,
    ownerSlot: input.ownerSlot,
    ownerMini: input.ownerMini,
  });
}

export function expectPeerSlotReply(fromSlot: string): string {
  return `peer slot-${fromSlot} reply`;
}

export function expectPeerReply(target: string): string {
  return `peer:${target} reply`;
}

export function expectRoomPeerReply(slug: string): string {
  return `chat-room:${slug} peer reply`;
}

export function expectRoomCallResolved(shortId: string): string {
  return `room-call:${shortId} resolved`;
}

export function expectRoomCallPending(shortId: string): string {
  return `room-call:${shortId} accept|decline`;
}

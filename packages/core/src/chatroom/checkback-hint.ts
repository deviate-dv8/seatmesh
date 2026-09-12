/** Parse expect from room say checkback arm: `chat-room:<slug> peer update (<kind>)`. */
export function parseRoomCommsExpect(expect: string): { slug: string; kind: string } | null {
  const m = expect.match(/^chat-room:([^\s]+) peer update \(([^)]+)\)$/);
  if (!m) return null;
  return { slug: m[1], kind: m[2] };
}

export interface RoomCommsReplyContext {
  role: string;
  slot?: string | number | null;
  mini?: string | number | null;
  ports?: string | null;
  workerCount?: number;
  miniMax?: number;
}

/** Compact seat token (harness `worker_inject_stamp` spirit: `slot-N ports P/P`). */
export function formatCompactSeat(ctx: RoomCommsReplyContext = { role: "worker" }): string {
  const role = ctx.role || "worker";
  if (role === "manager") return "manager";
  if (role === "secretary") return "secretary";
  if (role === "manager-mini" || ctx.mini) return `mini-${ctx.mini ?? "?"}`;
  const slot = ctx.slot;
  if (slot != null && String(slot).length > 0) {
    const ports = ctx.ports?.trim();
    return ports ? `slot-${slot} ${ports}` : `slot-${slot}`;
  }
  return "unknown";
}

/** @deprecated Prefer formatCompactSeat — kept for whoami/tests. */
export function formatSeatStamp(ctx: RoomCommsReplyContext = { role: "worker" }): string {
  return formatCompactSeat(ctx);
}

/**
 * Harness-aligned inject envelope (dense — patterns.md).
 * Manager mail: `[mesh-inbox] secretary: body` (like harness `[INBOX who]:`).
 * Peers: `[agent-worker-slot-N] TO-SLOT-M (ports): …` passthrough, or one-line header.
 */
export function formatMeshSteeringInject(
  ctx: RoomCommsReplyContext,
  tag: string,
  body: string,
): string {
  const text = body.trim();
  if (!text) return `[mesh-inbox] ${tag}`;

  if (ctx.role === "manager" && /^TO-MASTER from /i.test(tag)) {
    const from = tag.replace(/^TO-MASTER from /i, "").trim();
    return `[mesh-inbox] ${from}: ${text}`;
  }
  if (ctx.role === "manager" && /DIGEST/i.test(tag)) {
    return `[mesh-inbox] DIGEST: ${text}`;
  }
  if (/^\[agent-worker-slot-/m.test(text)) {
    return text;
  }

  const seat = formatCompactSeat(ctx);
  if (!text.includes("\n")) {
    return `${seat} | [mesh-inbox] ${tag}: ${text}`;
  }
  return `${seat} | [mesh-inbox] ${tag}\n${text}`;
}

/** Worker prompt lead stamp for inject prefix. */
export function formatWorkerInjectStamp(ctx: RoomCommsReplyContext): string {
  const seat = formatCompactSeat(ctx);
  return `${seat} -`;
}

/** Room reply one-liner (receiver copies, replaces `<msg>`). */
export function formatRoomSayReplyCmd(slug: string): string {
  const roomFlag = slug === "global" ? "" : ` -r ${slug}`;
  return `./sm.sh room say${roomFlag} "<msg>"`;
}

/** Peer to-slot reply one-liner (`fromSlot` = sender to answer). */
export function formatToSlotReplyCmd(fromSlot: string | number): string {
  return `./sm.sh to-slot ${fromSlot} "<msg>"`;
}

/** Short checkback / patience nudge (not a full playbook). */
export function formatCheckNudge(ctx: RoomCommsReplyContext, expect: string, hint: string): string {
  return `${formatCompactSeat(ctx)} | Check: ${expect} — ${hint}`;
}

/** Engineering reply block for room-comms checkback injects (compact). */
export function formatRoomCommsCheckback(
  expect: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
): string {
  const parsed = parseRoomCommsExpect(expect);
  const slug = parsed?.slug ?? "global";
  const roomFlag = slug === "global" ? "" : ` -r ${slug}`;
  const tailCmd = `./sm.sh room tail${roomFlag} -n 30`;
  return formatCheckNudge(ctx, expect, `${tailCmd} | reply ${formatRoomSayReplyCmd(slug)}`);
}

export interface RoomPeerNotifyOpts {
  unseen?: number;
}

/** Thin PEER wake-up for multi-member rooms (3+). Ledger is truth — no body relay. */
export function formatRoomPeerNotify(
  slug: string,
  kind: string,
  from: string,
  _body: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
  opts: RoomPeerNotifyOpts = {},
): string {
  const roomFlag = slug === "global" ? "" : ` -r ${slug}`;
  const unseen = opts.unseen ?? 0;
  const unseenPart = unseen > 0 ? ` ${unseen} unseen` : "";
  const tail = `./sm.sh room tail${roomFlag} -n 15`;
  const seat = formatCompactSeat(ctx);
  const tag = `${slug} | ${from} | ${kind}${unseenPart}`;
  return `${seat} | [mesh-inbox-room] ${tag}\nVerify: ${tail} (no chat reply — continue FOCUS/TASKS hub)`;
}

/** Rich PEER for manager / secretary / mini-leads / lead-workers — includes claim body snippet. */
export function formatRoomCoordNotify(
  slug: string,
  kind: string,
  from: string,
  body: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
  opts: RoomPeerNotifyOpts = {},
): string {
  const roomFlag = slug === "global" ? "" : ` -r ${slug}`;
  const unseen = opts.unseen ?? 0;
  const unseenPart = unseen > 1 ? ` (+${unseen - 1} more unseen)` : "";
  const seat = formatCompactSeat(ctx);
  const text = body.trim();
  const snippet = text.length > 480 ? `${text.slice(0, 477)}...` : text;
  const tail = `./sm.sh room tail${roomFlag} -n 15`;
  return `${seat} | [mesh-inbox-room] ${slug} | ${from} | ${kind}${unseenPart}\n${snippet}\nVerify: ${tail} (no chat reply — continue FOCUS/TASKS hub)`;
}

/** Harness-style direct room line (2-member rooms, @mentions). */
export function formatRoomDirectPm(
  slug: string,
  from: string,
  fromSlot: string,
  fromPorts: string,
  body: string,
  _ctx: RoomCommsReplyContext = { role: "worker" },
): string {
  const text = body.trim();
  return `[agent-worker-slot-${fromSlot}] room ${slug} (${fromPorts}) from ${from}: ${text} — reply ${formatRoomSayReplyCmd(slug)}`;
}

export function parseRoomCallExpect(
  expect: string,
): { callId: string; phase: "resolved" | "accept|decline" } | null {
  const m = expect.match(/^room-call:([^\s]+) (resolved|accept\|decline)$/);
  if (!m) return null;
  return { callId: m[1], phase: m[2] as "resolved" | "accept|decline" };
}

export function formatRoomCallCheckback(
  expect: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
): string {
  const parsed = parseRoomCallExpect(expect);
  const callId = parsed?.callId ?? "?";
  if (parsed?.phase === "accept|decline") {
    return formatCheckNudge(
      ctx,
      expect,
      `./sm.sh room accept ${callId} | ./sm.sh room decline ${callId}`,
    );
  }
  return formatCheckNudge(ctx, expect, `./sm.sh room calls (${callId})`);
}

export function formatRoomCallInvite(
  callShortId: string,
  fromAgent: string,
  topic: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
): string {
  const topicLine = topic.length > 120 ? `${topic.slice(0, 117)}...` : topic;
  return formatMeshSteeringInject(
    ctx,
    `CALL ${fromAgent}`,
    `${topicLine} — ./sm.sh room accept ${callShortId} | decline ${callShortId}`,
  );
}

export function formatRoomCallResolved(
  status: "accepted" | "declined",
  peerAgent: string,
  roomSlug: string | null,
  callShortId: string,
  reason?: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
): string {
  if (status === "accepted" && roomSlug) {
    return formatMeshSteeringInject(
      ctx,
      `ACCEPTED ${peerAgent}`,
      `./sm.sh room tail -r ${roomSlug} -n 10`,
    );
  }
  const why = reason?.trim() ? ` (${reason.trim().slice(0, 80)})` : "";
  return formatMeshSteeringInject(ctx, `DECLINED ${callShortId}`, `${peerAgent}${why}`);
}

export function formatGenericCheckback(
  expect: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
): string {
  const digestId = expect.match(/digest queued ([a-f0-9-]+)/i)?.[1];
  if (digestId) {
    return formatCheckNudge(
      ctx,
      expect,
      `./sm.sh inbox list | grep ${digestId.slice(0, 8)}`,
    );
  }
  if (/proxy ipify|OC-LIMIT|Cannot connect/i.test(expect)) {
    return formatCheckNudge(ctx, expect, "./sm.sh proxy status");
  }
  return formatCheckNudge(ctx, expect, "./sm.sh checkback list | cancel <id>");
}

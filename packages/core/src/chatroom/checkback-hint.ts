import { MESH_INBOX_ROOM_TAG, MESH_INBOX_TAG, meshInboxCheckbackVerify } from "../messages/mesh-copy.js";
import { seatmeshCmd } from "../messages/cli-hints.js";

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
  const role = ctx.role || "plain";
  if (role === "manager" || role === "master") return "manager";
  if (role === "secretary" || role.startsWith("secretary-") || role.startsWith("manager-")) {
    return role;
  }
  if (role !== "worker" && role !== "manager-mini") return role;
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
  if (!text) return `${MESH_INBOX_TAG} ${tag}`;

  if (ctx.role === "manager" && /^TO-MASTER from /i.test(tag)) {
    const from = tag.replace(/^TO-MASTER from /i, "").trim();
    return `${MESH_INBOX_TAG} ${from}: ${text}`;
  }
  if (ctx.role === "manager" && /DIGEST/i.test(tag)) {
    return `${MESH_INBOX_TAG} DIGEST: ${text}`;
  }
  if (/^\[agent-worker-slot-/m.test(text)) {
    return text;
  }

  const seat = formatCompactSeat(ctx);
  if (!text.includes("\n")) {
    return `${seat} | ${MESH_INBOX_TAG} ${tag}: ${text}`;
  }
  return `${seat} | ${MESH_INBOX_TAG} ${tag}\n${text}`;
}

/** Worker prompt lead stamp for inject prefix. */
export function formatWorkerInjectStamp(ctx: RoomCommsReplyContext): string {
  const seat = formatCompactSeat(ctx);
  return `${seat} -`;
}

/** Room reply one-liner (receiver runs in shell, replaces `<msg>`). */
export function formatRoomSayReplyCmd(slug: string): string {
  const roomFlag = slug === "global" ? "" : ` -r ${slug}`;
  return seatmeshCmd(`room say${roomFlag} "<msg>"`);
}

/** Peer to-slot reply one-liner (`fromSlot` = sender to answer). */
export function formatToSlotReplyCmd(fromSlot: string | number): string {
  return `to-slot ${fromSlot} "<msg>"`;
}

/** Coordinator peer reply one-liner (`fromRole` = sender column id). */
export function formatPeerReplyCmd(fromRole: string): string {
  return seatmeshCmd(`peer ${fromRole} "<msg>"`);
}

/** Map room/ledger agent id to the one `seatmesh --profile .sm peer` target (no second harness). */
export function peerTargetFromAgentId(from: string): string {
  const id = from.trim();
  if (!id || id === "master") return "manager";
  const worker = id.match(/^worker-(\d+)$/i);
  if (worker) return `slot-${worker[1]}`;
  const mini = id.match(/^mini-(\d+)$/i);
  if (mini) return `mini-${mini[1]}`;
  const managerMini = id.match(/^manager-mini-(\d+)$/i);
  if (managerMini) return `mini-${managerMini[1]}`;
  if (id.toLowerCase() === "manager-mini" || id === "mini") return "mini-?";
  return id;
}

/** Inbound comms footer — run in shell same turn; composer prose does not deliver. */
export function formatReplyToSender(from: string): string {
  const shell = formatPeerReplyCmd(peerTargetFromAgentId(from));
  return `SHELL (required — chat-only "received" does NOT file): ${shell}`;
}

/**
 * Prefix that matches store cancel (`id.startsWith(needle)`).
 * Keep the `cb-` prefix — stripping it made inject cancel lines miss the row.
 */
export function shortCheckbackId(id: string): string {
  const t = id.trim();
  if (!t) return t;
  if (t.length <= 14) return t;
  return t.slice(0, 14);
}

/** Quiet cancel shell for checkback-verify (never the lead line — see mesh-copy CHECKBACK_VERIFY). */
export function formatCheckbackCancelHint(id?: string | null): string {
  const cancel = id?.trim()
    ? seatmeshCmd(`cb cancel ${shortCheckbackId(id)}`)
    : `${seatmeshCmd("cb list")} → ${seatmeshCmd("cb cancel <id>")}`;
  return cancel;
}

export interface CheckNudgeOpts {
  /** CHECKBACK.jsonl id — prefer so cancel is one shell line. */
  id?: string | null;
}

/**
 * intent=checkback-verify nudge — copy from mesh-copy.ts CONSTS only.
 * Agent must run cb cancel (shell) then CONTINUE hub. Chat "Ignored" is useless.
 */
export function formatCheckNudge(
  ctx: RoomCommsReplyContext,
  expect: string,
  hint: string,
  opts: CheckNudgeOpts = {},
): string {
  return meshInboxCheckbackVerify({
    seat: formatCompactSeat(ctx),
    expect,
    hint,
    cancelCmd: formatCheckbackCancelHint(opts.id),
  });
}

export interface RoomCommsCheckbackOpts {
  /** Daemon poll-later — no Reply: peer footer (keep working on hub). */
  verifyOnly?: boolean;
  id?: string | null;
}

/** Engineering reply block for room-comms checkback injects (compact). */
export function formatRoomCommsCheckback(
  expect: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
  from?: string | null,
  opts: RoomCommsCheckbackOpts = {},
): string {
  if (opts.verifyOnly) {
    return formatCheckNudge(ctx, expect, "room ledger glance", { id: opts.id });
  }
  // Needs a peer reply — not a pure verify/continue poll.
  const reply = from?.trim()
    ? formatReplyToSender(from)
    : "inbound already has Reply: peer <sender>";
  return (
    `${formatCompactSeat(ctx)} | ${MESH_INBOX_TAG} Check: ${expect} — ${reply}\n` +
    `SHELL (required — kill this poll NOW; chat does NOT cancel): ${formatCheckbackCancelHint(opts.id)}`
  );
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
  const unseen = opts.unseen ?? 0;
  const unseenPart = unseen > 0 ? ` ${unseen} unseen` : "";
  const seat = formatCompactSeat(ctx);
  const tag = `${slug} | ${from} | ${kind}${unseenPart}`;
  const roomFlag = slug === "global" ? "" : ` -r ${slug}`;
  return (
    `${seat} | ${MESH_INBOX_ROOM_TAG} ${tag}\n` +
    `Verify: ${seatmeshCmd(`room tail${roomFlag} -n 15`)}\n${formatReplyToSender(from)}`
  );
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
  const unseen = opts.unseen ?? 0;
  const unseenPart = unseen > 1 ? ` (+${unseen - 1} more unseen)` : "";
  const seat = formatCompactSeat(ctx);
  const text = body.trim();
  const snippet = text.length > 480 ? `${text.slice(0, 477)}...` : text;
  return `${seat} | ${MESH_INBOX_ROOM_TAG} ${slug} | ${from} | ${kind}${unseenPart}\n${snippet}\n${formatReplyToSender(from)}`;
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
  return `[agent-worker-slot-${fromSlot}] room ${slug} (${fromPorts}) from ${from}: ${text}\n${formatReplyToSender(from)}`;
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
  opts: CheckNudgeOpts = {},
): string {
  const parsed = parseRoomCallExpect(expect);
  const callId = parsed?.callId ?? "?";
  if (parsed?.phase === "accept|decline") {
    return formatCheckNudge(
      ctx,
      expect,
      `then room accept ${callId} | room decline ${callId}`,
      opts,
    );
  }
  return formatCheckNudge(ctx, expect, `room calls (${callId})`, opts);
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
    `${topicLine} — room accept ${callShortId} | decline ${callShortId}`,
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
      `room tail -r ${roomSlug} -n 10`,
    );
  }
  const why = reason?.trim() ? ` (${reason.trim().slice(0, 80)})` : "";
  return formatMeshSteeringInject(ctx, `DECLINED ${callShortId}`, `${peerAgent}${why}`);
}

export function formatGenericCheckback(
  expect: string,
  ctx: RoomCommsReplyContext = { role: "worker" },
  opts: CheckNudgeOpts = {},
): string {
  const digestId = expect.match(/digest queued ([a-f0-9-]+)/i)?.[1];
  if (digestId) {
    return formatCheckNudge(
      ctx,
      expect,
      `inbox list | grep ${digestId.slice(0, 8)}`,
      opts,
    );
  }
  if (/proxy ipify|OC-LIMIT|Cannot connect/i.test(expect)) {
    return formatCheckNudge(ctx, expect, "proxy status", opts);
  }
  return formatCheckNudge(ctx, expect, "", opts);
}

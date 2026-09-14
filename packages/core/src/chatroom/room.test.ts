import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProfile } from "../profile/profile.js";
import {
  chatRoomConfig,
  createRoom,
  sayInRoom,
  tailRoom,
  looksLikeExpectsReply,
  ensureGlobalRoom,
  stampActionableBody,
  type ChatRoomConfig,
} from "./room.js";
import {
  formatGenericCheckback,
  formatRoomCommsCheckback,
  formatRoomCoordNotify,
  formatRoomDirectPm,
  formatRoomPeerNotify,
  formatSeatStamp,
  parseRoomCommsExpect,
} from "./checkback-hint.js";
import { peerTargetForComms, resolveAgentId } from "./agent-id.js";
import { lastInboundRoomFrom } from "./read-state.js";
import { parseDurationToSeconds } from "./duration.js";
import { checkbackTimingForExpect, isRoomCallExpect } from "./comms-checkback.js";
import { canBroadcastToGlobal, isGlobalSlug, resolveRoomSlug } from "./global.js";

describe("resolveAgentId", () => {
  it("maps roles", () => {
    expect(resolveAgentId({ role: "manager-mini", mini: 4 })).toBe("mini-4");
    expect(resolveAgentId({ role: "worker", slot: 2 })).toBe("worker-2");
    expect(resolveAgentId({ role: "secretary" })).toBe("secretary");
  });
});

describe("peerTargetForComms", () => {
  it("never emits bare manager-mini", () => {
    expect(peerTargetForComms({ role: "manager-mini", mini: 1 })).toBe("mini-1");
    expect(peerTargetForComms({ role: "manager" })).toBe("manager");
  });
});

describe("parseDurationToSeconds (ms package)", () => {
  it("parses units", () => {
    expect(parseDurationToSeconds("30s")).toBe(30);
    expect(parseDurationToSeconds("5m")).toBe(300);
    expect(parseDurationToSeconds("1h")).toBe(3600);
  });
});

const testChatCfg: ChatRoomConfig = {
  root: "tasks/chat-rooms",
  globalSlug: "global",
  checkbackDuration: "5m",
  checkbackRenew: "3m",
  checkbackCallPendingDuration: "1m",
  checkbackCallPendingRenew: "1m",
  inboxBase: "http://127.0.0.1:1",
};

describe("stampActionableBody", () => {
  it("appends [@ts] on DONE/CLAIM/BLOCKED", () => {
    const ts = "2026-09-11T17:43:51.995Z";
    expect(stampActionableBody(ts, "DONE: slice ok", "done")).toBe(
      "DONE: slice ok [@2026-09-11T17:43:51Z]",
    );
    expect(stampActionableBody(ts, "FYI: note", "fyi")).toBe("FYI: note");
    expect(stampActionableBody(ts, "DONE: already [@2026-09-11T12:00:00Z]", "done")).toBe(
      "DONE: already [@2026-09-11T12:00:00Z]",
    );
  });
});

describe("checkbackTimingForExpect", () => {
  it("uses 1m for room-call pending ack", () => {
    expect(isRoomCallExpect("room-call:abc resolved")).toBe(true);
    const t = checkbackTimingForExpect(testChatCfg, "room-call:abc resolved");
    expect(t.duration).toBe("1m");
    expect(t.renew).toBe("1m");
    const peer = checkbackTimingForExpect(testChatCfg, "peer slot-3 reply");
    expect(peer.duration).toBe("5m");
    expect(peer.renew).toBe("3m");
  });
});

describe("global room", () => {
  const cfg = testChatCfg;

  it("resolveRoomSlug defaults to global", () => {
    expect(resolveRoomSlug(cfg)).toBe("global");
    expect(resolveRoomSlug(cfg, "my-contract")).toBe("my-contract");
  });

  it("canBroadcastToGlobal is manager/secretary only", () => {
    expect(canBroadcastToGlobal("manager")).toBe(true);
    expect(canBroadcastToGlobal("secretary")).toBe(true);
    expect(canBroadcastToGlobal("worker")).toBe(false);
    expect(isGlobalSlug(cfg, "global")).toBe(true);
  });
});

describe("formatSeatStamp", () => {
  it("compact worker slot + ports", () => {
    expect(formatSeatStamp({ role: "worker", slot: 3, ports: "3030/3031" })).toBe(
      "slot-3 3030/3031",
    );
    expect(formatSeatStamp({ role: "manager" })).toBe("manager");
  });
});

describe("lastInboundRoomFrom", () => {
  it("returns latest from that is not self", () => {
    const rows = [
      { from: "manager" },
      { from: "manager-2" },
      { from: "manager" },
    ] as { from: string }[];
    expect(lastInboundRoomFrom(rows as never, "manager")).toBe("manager-2");
    expect(lastInboundRoomFrom(rows as never, "manager-2")).toBe("manager");
  });
});

describe("formatRoomCommsCheckback", () => {
  it("one-line check nudge with tail + say", () => {
    const msg = formatRoomCommsCheckback("chat-room:global peer update (broadcast)", {
      role: "worker",
      slot: 3,
      ports: "3030/3031",
      workerCount: 6,
    });
    expect(msg).toContain("inbound already has");
    expect(msg).toContain("peer");
    expect(msg).toContain("cb cancel");
    expect(msg).toContain("queued");
    expect(
      formatRoomCommsCheckback(
        "chat-room:managers peer update (msg)",
        { role: "manager" },
        "manager-2",
      ),
    ).toContain('seatmesh agent peer manager-2 "<msg>"');
    expect(parseRoomCommsExpect("chat-room:supervise peer update (claim)")?.slug).toBe(
      "supervise",
    );
  });

  it("does not offer a second harness", () => {
    const msg = formatRoomCommsCheckback("chat-room:supervise peer update (claim)", {
      role: "manager",
    });
    expect(msg).not.toContain("room say");
    expect(msg).not.toContain("room tail");
  });

  it("embeds cancel id when provided", () => {
    const msg = formatRoomCommsCheckback(
      "chat-room:global peer update (broadcast)",
      { role: "secretary" },
      null,
      { verifyOnly: true, id: "cb-peer-1234567890-abcdef" },
    );
    expect(msg).toContain("cb cancel peer-12345");
    expect(msg).toContain("chat reply does NOT cancel");
  });
});

describe("formatRoomCoordNotify", () => {
  it("rich ping for manager/secretary/leads — includes body snippet", () => {
    const msg = formatRoomCoordNotify(
      "supervise",
      "claim",
      "mini-5",
      "CLAIMED: proxy-restart lead slice — verify slot-2 DONE",
      { role: "manager" },
      { unseen: 15 },
    );
    expect(msg).toContain("[mesh-inbox-room] supervise | mini-5 | claim");
    expect(msg).toContain("CLAIMED: proxy-restart lead slice");
    expect(msg).toContain("(+14 more unseen)");
    expect(msg).toContain('seatmesh agent peer mini-5 "<msg>"');
    expect(msg).not.toContain("room tail");
  });
});

describe("formatRoomPeerNotify", () => {
  it("thin ping with unseen — no body relay", () => {
    const msg = formatRoomPeerNotify(
      "team-room",
      "fyi",
      "worker-3",
      "FYI: long body that must not appear in inject",
      { role: "worker", slot: 6, workerCount: 8 },
      { unseen: 2 },
    );
    expect(msg).toContain("[mesh-inbox-room] team-room | worker-3 | fyi 2 unseen");
    expect(msg).toContain("seatmesh agent room tail -r team-room -n 15");
    expect(msg).toContain('seatmesh agent peer slot-3 "<msg>"');
    expect(msg).not.toContain("long body that must not appear");
    expect(msg).not.toContain("standing:");
  });
});

describe("formatRoomDirectPm", () => {
  it("harness-style direct line for 2-member / @mention", () => {
    const msg = formatRoomDirectPm(
      "peer-3-6-abc",
      "worker-3",
      "3",
      "3030/3031",
      "FYI: round 1 take",
      { role: "worker", slot: 6 },
    );
    expect(msg).toContain("[agent-worker-slot-3] room peer-3-6-abc");
    expect(msg).toContain('seatmesh agent peer slot-3 "<msg>"');
  });
});

describe("formatGenericCheckback", () => {
  it("hints inbox grep for digest ACK", () => {
    const msg = formatGenericCheckback(
      "master ACK review of opencode provider TS fix (digest queued 400ac9c9)",
      { role: "manager" },
      { id: "cb-digest-aa" },
    );
    expect(msg).toContain("inbox list | grep 400ac9c9");
    expect(msg).toContain("cb cancel digest-aa");
    expect(msg).toContain("queued");
  });
});

describe("looksLikeExpectsReply", () => {
  it("flags human POV questions", () => {
    expect(looksLikeExpectsReply("Would you like me to continue?")).toBe(true);
    expect(looksLikeExpectsReply("CLAIMED: auth/login.block.ts")).toBe(false);
  });
});

describe("room file ops", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seatmesh-room-"));
  const workspace = tmp;
  const minimalDir = path.resolve(import.meta.dirname, "../../../../profiles/minimal");
  const loaded = loadProfile(minimalDir);
  const cfg = {
    ...chatRoomConfig(loaded.profile),
    root: "tasks/chat-rooms",
    inboxBase: "http://127.0.0.1:1",
  };

  afterEach(() => {
    const rooms = path.join(tmp, "tasks/chat-rooms");
    if (fs.existsSync(rooms)) fs.rmSync(rooms, { recursive: true, force: true });
  });

  it("ensureGlobalRoom auto-creates global", async () => {
    const profile = ensureGlobalRoom(workspace, cfg);
    expect(profile.kind).toBe("global");
    expect(profile.slug).toBe("global");
    await sayInRoom(workspace, cfg, "global", "worker-2", "FYI: global ping", {
      armCheckback: false,
    });
    const lines = await tailRoom(workspace, cfg, "global", 5);
    expect(lines.some((l) => l.body.includes("global ping"))).toBe(true);
  });

  it("create + say + tail", async () => {
    createRoom({
      workspace,
      cfg,
      slug: "test-contract",
      createdBy: "mini-1",
      scope: "slice auth",
    });
    await sayInRoom(workspace, cfg, "test-contract", "mini-4", "CLAIMED: src/foo.ts", {
      armCheckback: false,
    });
    const lines = await tailRoom(workspace, cfg, "test-contract", 10);
    expect(lines).toHaveLength(1);
    expect(lines[0].from).toBe("mini-4");
    expect(lines[0].kind).toBe("claim");
    expect(lines[0].body).toContain("CLAIMED:");
  });
});

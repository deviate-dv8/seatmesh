import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armAckRedirectBlock,
  applyAckRedirectBlock,
  findAckRedirectBlock,
  normalizeRedirectSeat,
  senderSeatFromPeer,
} from "./ack-redirect-block.js";
import type { PeerRow } from "../store/create-queue-store.js";

vi.mock("@seat-mesh/tmux", () => ({
  resolvePaneTarget: (label: string) => {
    if (label === "secretary") return { paneId: "%sec", label: "secretary" };
    if (label === "manager") return { paneId: "%mgr", label: "manager" };
    return { error: `unknown ${label}` };
  },
}));

describe("ack-redirect-block", () => {
  let tmp = "";
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("normalizes seats", () => {
    expect(normalizeRedirectSeat("mini-1")).toBe("mini-1");
    expect(normalizeRedirectSeat("MINI-2")).toBe("mini-2");
    expect(normalizeRedirectSeat("slot-3")).toBe("worker-3");
    expect(normalizeRedirectSeat("3")).toBe("worker-3");
    expect(normalizeRedirectSeat("master")).toBe("manager");
  });

  it("senderSeatFromPeer prefers fromAgent mini", () => {
    expect(senderSeatFromPeer({ fromAgent: "mini-1", fromSlot: "1" })).toBe("mini-1");
    expect(senderSeatFromPeer({ fromSlot: "mini-2" })).toBe("mini-2");
  });

  it("arms block and rewrites ACK-class manager → secretary", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arb-"));
    armAckRedirectBlock(tmp, {
      fromSeat: "mini-1",
      blockTarget: "*managers",
      rewriteTo: "secretary",
      ttlMs: 60_000,
    });
    expect(findAckRedirectBlock(tmp, "mini-1", "manager")).not.toBeNull();

    const row = {
      id: "1",
      at: new Date().toISOString(),
      kind: "to-slot" as const,
      fromSlot: "mini-1",
      fromPorts: null,
      roomSlug: null,
      fromAgent: "mini-1",
      targetPane: "%mgr",
      targetLabel: "manager",
      msg: "ACK: still on it",
      sent: false,
    } satisfies PeerRow;

    const loaded = { profile: {}, workspace: tmp } as never;
    const r = applyAckRedirectBlock(tmp, loaded, row);
    expect(r.redirected).toBe(true);
    expect(row.targetLabel).toBe("secretary");
    expect(row.targetPane).toBe("%sec");
    expect(row.msg).toMatch(/\[ack-redirect:manager→secretary\]/);
  });

  it("does not rewrite substance asks", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arb-"));
    armAckRedirectBlock(tmp, { fromSeat: "mini-1" });
    const row = {
      id: "2",
      at: new Date().toISOString(),
      kind: "to-slot" as const,
      fromSlot: "mini-1",
      fromPorts: null,
      roomSlug: null,
      fromAgent: "mini-1",
      targetPane: "%mgr",
      targetLabel: "manager",
      msg: "PROVED: gate green — see diff",
      sent: false,
    } satisfies PeerRow;
    const r = applyAckRedirectBlock(tmp, { profile: {} } as never, row);
    expect(r.redirected).toBe(false);
    expect(row.targetLabel).toBe("manager");
  });
});

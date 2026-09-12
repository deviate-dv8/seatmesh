import { describe, expect, it } from "vitest";
import type { PeerRow } from "./jsonl-store.js";
import { shouldSkipGlobalWorkerRoomPing } from "./peer-skip.js";

const base: PeerRow = {
  id: "x",
  at: "2026-09-12T00:00:00.000Z",
  kind: "room",
  fromSlot: "6",
  fromPorts: "3060/3061",
  roomSlug: "global",
  fromAgent: "worker-6",
  targetPane: "%3",
  targetLabel: "slot-1",
  msg: "slot-1 3010/3011 | [mesh-inbox-room] global | worker-6 | fyi 18 unseen\nVerify: ./sm.sh room tail -n 15",
  sent: false,
};

describe("shouldSkipGlobalWorkerRoomPing", () => {
  it("skips global thin fyi to worker slot", () => {
    expect(shouldSkipGlobalWorkerRoomPing(base)).toBe(true);
  });

  it("does not skip global to mini", () => {
    expect(shouldSkipGlobalWorkerRoomPing({ ...base, targetLabel: "mini-1" })).toBe(false);
  });

  it("does not skip supervise room to worker", () => {
    expect(
      shouldSkipGlobalWorkerRoomPing({ ...base, roomSlug: "supervise", targetLabel: "slot-1" }),
    ).toBe(false);
  });

  it("does not skip global rich broadcast to worker", () => {
    expect(
      shouldSkipGlobalWorkerRoomPing({
        ...base,
        msg: "[mesh-inbox-room] global | manager | broadcast\nBROADCAST: smoke",
      }),
    ).toBe(false);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  recordThinRoomNotify,
  shouldSkipThinRoomNotify,
} from "./read-state.js";
import { ensureGlobalRoom, type ChatRoomConfig } from "./room.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function cfg(): ChatRoomConfig {
  return {
    root: "chat-rooms",
    globalSlug: "global",
    checkbackDuration: "5m",
    checkbackRenew: "3m",
    checkbackCallPendingDuration: "1m",
    checkbackCallPendingRenew: "1m",
    checkbackMaxFires: 3,
    thinNotifyMinMs: 5 * 60 * 1000,
    inboxBase: "http://127.0.0.1:31670",
  };
}

describe("thin room notify dedupe", () => {
  it("skips on cooldown even when unseen grows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seatmesh-thin-"));
    tmpDirs.push(root);
    ensureGlobalRoom(root, cfg());
    const now = Date.parse("2026-09-13T18:00:00.000Z");
    recordThinRoomNotify(root, cfg(), "global", "secretary", 15, now);
    expect(shouldSkipThinRoomNotify(root, cfg(), "global", "secretary", 15, now + 60_000)).toBe(
      true,
    );
    // Busy rooms grow unseen every FYI — still skip inside the window.
    expect(shouldSkipThinRoomNotify(root, cfg(), "global", "secretary", 60, now + 60_000)).toBe(
      true,
    );
    expect(
      shouldSkipThinRoomNotify(root, cfg(), "global", "secretary", 60, now + 6 * 60_000),
    ).toBe(false);
  });
});

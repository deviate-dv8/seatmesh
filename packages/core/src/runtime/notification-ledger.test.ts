import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listNotifications,
  markNotificationActed,
  readNotifications,
  recordNotification,
  summarizeNotifications,
} from "./notification-ledger.js";

const tmpFiles: string[] = [];

function tmpFile(): string {
  const f = path.join(os.tmpdir(), `sm-ntf-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  tmpFiles.push(f);
  return f;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ok */
    }
  }
});

describe("notification-ledger", () => {
  it("records and lists sent notifications", () => {
    const file = tmpFile();
    recordNotification(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      kind: "yesno",
      title: "Ship?",
      body: "Need your call",
      infoUrl: "http://127.0.0.1:3190/act/card/abc",
      cardId: "abc",
      targetSeat: "manager",
    });
    expect(readNotifications(file)).toHaveLength(1);
    expect(listNotifications(file)).toHaveLength(1);
    const s = summarizeNotifications(readNotifications(file));
    expect(s.sent).toBe(1);
  });

  it("marks acted by act token", () => {
    const file = tmpFile();
    recordNotification(file, {
      sessionId: "s1",
      sessionName: "mesh-s1",
      kind: "yesno",
      title: "Go?",
      links: [{ label: "Yes", token: "tok-yes", url: "http://x/act/v1/tok-yes" }],
    });
    const done = markNotificationActed(file, { actToken: "tok-yes", label: "Yes" });
    expect(done?.status).toBe("acted");
    expect(listNotifications(file)).toHaveLength(0);
    expect(listNotifications(file, { all: true })).toHaveLength(1);
  });
});

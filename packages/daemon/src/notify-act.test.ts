import { describe, expect, it } from "vitest";
import { createNotifyActRegistry, executeNotifyAct } from "./notify-act.js";
import { JsonlStore } from "./jsonl-store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("notify-act registry", () => {
  it("register returns one-shot URLs and take consumes token", async () => {
    const reg = createNotifyActRegistry();
    const links = reg.register(
      [{ label: "Ping", type: "ping", params: {} }],
      300,
      "http://127.0.0.1:31670",
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toContain("/act/v1/");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-act-"));
    const store = new JsonlStore(dir);
    const logs: string[] = [];
    const row = reg.take(links[0]!.token);
    expect(row).not.toBeNull();
    expect(reg.take(links[0]!.token)).toBeNull();

    const result = await executeNotifyAct(row!, {
      loaded: { workspace: dir, profileDir: dir, profilePath: dir, profile: {} } as never,
      store,
      log: (l) => logs.push(l),
      onPeerEnqueued: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(logs.some((l) => l.includes("NOTIFY-ACT ping"))).toBe(true);
  });
});

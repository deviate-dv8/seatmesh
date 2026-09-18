import { describe, expect, it } from "vitest";
import { createNotifyActRegistry, executeNotifyAct } from "./notify-act.js";
import { JsonlStore } from "../store/jsonl-store.js";
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

  it("registerCard returns hub infoUrl and getCard until expiry", () => {
    const reg = createNotifyActRegistry();
    const links = reg.register(
      [
        { label: "Yes", type: "ping", params: {} },
        { label: "No", type: "ping", params: {} },
      ],
      300,
      "http://127.0.0.1:31670",
    );
    const card = reg.registerCard(
      { title: "Ship?", body: "Blue button ok?", links },
      300,
      {
        infoUrl: (id) => `http://127.0.0.1:3190/act/card/${id}?port=31670`,
      },
    );
    expect(card.infoUrl).toBe(`http://127.0.0.1:3190/act/card/${card.id}?port=31670`);
    expect(reg.getCard(card.id)?.title).toBe("Ship?");
    expect(reg.getCard(card.id)?.links).toHaveLength(2);
  });

  it("annotatePeerMsgsWithCard stamps card/info/target/session on operator-decide peers", () => {
    const reg = createNotifyActRegistry();
    const links = reg.register(
      [
        {
          label: "Yes",
          type: "peer",
          params: {
            target: "manager",
            msg: "PRIORITY [operator-decide] YES — Act card → hub",
            kind: "prompt",
          },
        },
        {
          label: "No",
          type: "peer",
          params: {
            target: "manager",
            msg: "PRIORITY [operator-decide] NO — Act card → hub",
            kind: "prompt",
          },
        },
      ],
      300,
      "http://127.0.0.1:31670",
    );
    const card = reg.registerCard(
      { title: "Act card → hub", body: "x", links },
      300,
      { infoUrl: (id) => `http://127.0.0.1:3190/act/card/${id}?port=31670` },
    );
    reg.annotatePeerMsgsWithCard({
      cardId: card.id,
      infoUrl: card.infoUrl,
      session: "mesh-c87d62",
    });
    const yes = reg.take(links[0]!.token);
    expect(yes?.params.msg).toContain(`card=${card.id}`);
    expect(String(yes?.params.msg)).toContain("info=http://127.0.0.1:3190/act/card/");
    expect(String(yes?.params.msg)).toContain("target=manager");
    expect(String(yes?.params.msg)).toContain("session=mesh-c87d62");
  });

  it("run-cmd executes under workspace and refuses escape cwd", async () => {
    const reg = createNotifyActRegistry();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-run-"));
    fs.writeFileSync(path.join(dir, "marker.txt"), "ok\n");
    const links = reg.register(
      [
        {
          label: "Run",
          type: "run-cmd",
          params: { cmd: "cat marker.txt", cwd: "" },
        },
      ],
      300,
      "http://127.0.0.1:31670",
    );
    const store = new JsonlStore(dir);
    const row = reg.take(links[0]!.token)!;
    const ok = await executeNotifyAct(row, {
      loaded: { workspace: dir, profileDir: dir, profilePath: dir, profile: {} } as never,
      store,
      log: () => {},
      onPeerEnqueued: async () => {},
    });
    expect(ok.ok).toBe(true);
    expect(ok.summary).toContain("marker.txt");
    expect(ok.summary).toMatch(/\bok\b/);

    const bad = await executeNotifyAct(
      {
        token: "x",
        label: "Run",
        type: "run-cmd",
        params: { cmd: "echo no", cwd: "/tmp" },
        expiresAt: Date.now() + 60_000,
        used: false,
      },
      {
        loaded: { workspace: dir, profileDir: dir, profilePath: dir, profile: {} } as never,
        store,
        log: () => {},
        onPeerEnqueued: async () => {},
      },
    );
    expect(bad.ok).toBe(false);
    expect(bad.summary).toMatch(/cwd must stay under workspace/);
  });
});

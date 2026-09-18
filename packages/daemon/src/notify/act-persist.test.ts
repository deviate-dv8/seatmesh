import { describe, expect, it } from "vitest";
import { createNotifyActRegistry } from "./notify-act.js";
import { restoreActRegistry, saveActRegistry } from "./act-persist.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("act-persist", () => {
  it("round-trips cards through disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-act-"));
    const file = path.join(dir, "ACT-CARDS.jsonl");
    const reg = createNotifyActRegistry();
    const links = reg.register(
      [{ label: "Yes", type: "ping", params: {} }],
      3600,
      "http://127.0.0.1:1",
    );
    const card = reg.registerCard(
      { title: "T", body: "B", links },
      3600,
      "http://127.0.0.1:1",
    );
    saveActRegistry(file, reg);

    const reg2 = createNotifyActRegistry();
    expect(restoreActRegistry(file, reg2)).toBe(1);
    expect(reg2.getCard(card.id)?.title).toBe("T");
  });
});

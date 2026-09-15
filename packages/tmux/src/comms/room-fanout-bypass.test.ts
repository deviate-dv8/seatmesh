import { describe, expect, it } from "vitest";

/**
 * Room broadcast must never storm "direct inject only" bypass WARNs.
 * queueOnly / noBypass ⇒ failed when inbox/enqueue cannot queue.
 */
describe("room fan-out no-bypass contract", () => {
  it("documents queueOnly implies noBypass in deliverPeerMessage", async () => {
    // Structural: source keeps queueOnly ⇒ noBypass coupling.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "peer-send.ts",
    );
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/noBypass === true \|\| opts\.queueOnly === true/);
    expect(src).toMatch(/if \(noBypass\) return "failed"/);
  });

  it("room-fanout prefers batch /room-fanout", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "room-fanout.ts",
    );
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/enqueueRoomFanout/);
    expect(src).toMatch(/no direct-inject storm/);
    expect(src).toMatch(/noBypass: true/);
  });
});

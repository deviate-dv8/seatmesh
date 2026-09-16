import { describe, expect, it } from "vitest";
import { formatPeerBulkDigest, takePeerBulkBatch, PEER_BULK_MAX } from "@seat-mesh/core";

describe("todo remaining bulk after check", () => {
  it("formats remaining open tasks as peer-bulk DIGEST (same as inbox DIGEST)", () => {
    const remaining = ["TASK: alpha", "TASK: beta", "TASK: gamma"];
    const { batch, rest } = takePeerBulkBatch(remaining, PEER_BULK_MAX);
    expect(rest).toHaveLength(0);
    const digest = formatPeerBulkDigest({
      seat: "slot-1",
      items: batch.map((t) => ({ from: "tasks", body: `OPEN TASK: ${t}` })),
      more: rest.length,
    });
    expect(digest).toMatch(/DIGEST 3 mail/);
    expect(digest).toMatch(/OPEN TASK: TASK: alpha/);
    expect(digest).toMatch(/OPEN TASK: TASK: beta/);
    expect(digest).toMatch(/OPEN TASK: TASK: gamma/);
    expect(digest).toMatch(/FYI only/);
  });

  it("caps batch at PEER_BULK_MAX and reports more", () => {
    const remaining = Array.from({ length: 7 }, (_, i) => `TASK: n${i}`);
    const { batch, rest } = takePeerBulkBatch(remaining, PEER_BULK_MAX);
    expect(batch).toHaveLength(PEER_BULK_MAX);
    expect(rest).toHaveLength(2);
    const digest = formatPeerBulkDigest({
      seat: "manager",
      items: batch.map((t) => ({ from: "tasks", body: `OPEN TASK: ${t}` })),
      more: rest.length,
    });
    expect(digest).toMatch(/\(\+2 more queued/);
  });
});

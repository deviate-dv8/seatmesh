import { describe, expect, it } from "vitest";
import {
  PEER_BULK_MAX,
  formatPeerBulkDigest,
  takePeerBulkBatch,
} from "./peer-bulk.js";

describe("formatPeerBulkDigest", () => {
  it("caps at PEER_BULK_MAX and embeds ack close (reply optional)", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      from: `slot-${i + 1}`,
      body: `[from:slot-${i + 1} to:secretary] please confirm item ${i + 1}`,
      ackId: `ack-aaaaaa${i}`,
    }));
    const text = formatPeerBulkDigest({
      seat: "secretary",
      items: items.slice(0, PEER_BULK_MAX),
      more: 2,
    });
    expect(text).toContain("[mesh-inbox] DIGEST 5 mail");
    expect(text).toContain("1/5 [slot-1]");
    expect(text).toContain("5/5 [slot-5]");
    expect(text).toContain("ack aaaaaa");
    expect(text).toContain("close with ack");
    expect(text).toContain("(+2 more queued");
    expect(text).not.toContain("6/5");
  });

  it("strips Reply: seatmesh footers and marks FYI-only when no ack ids", () => {
    const text = formatPeerBulkDigest({
      seat: "manager",
      items: [
        {
          from: "secretary",
          body:
            "COORD PROVE PASS item 1\nReply: seatmesh agent peer secretary \"<msg>\"\n[sent:smu279easx25m]",
        },
      ],
    });
    expect(text).toContain("FYI only (no open ask)");
    expect(text).not.toContain("Reply: seatmesh");
    expect(text).not.toContain("[sent:");
  });

  it("takePeerBulkBatch splits at 5", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7];
    const { batch, rest } = takePeerBulkBatch(rows);
    expect(batch).toEqual([1, 2, 3, 4, 5]);
    expect(rest).toEqual([6, 7]);
  });
});

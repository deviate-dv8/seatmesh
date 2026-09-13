import { describe, expect, it } from "vitest";
import {
  isRealDeliverPane,
  peerRowSentProof,
  stampSentToken,
} from "./prompt-sent.js";

describe("prompt-sent", () => {
  it("stamps a unique token once", () => {
    const a = stampSentToken("ASSIGN: 5.6");
    expect(a.body).toContain("[sent:");
    expect(a.body).toContain(a.token);
    const b = stampSentToken(a.body);
    expect(b.token).toBe(a.token);
    expect(b.body).toBe(a.body);
  });

  it("rejects backlog/skipped as sent proof", () => {
    expect(isRealDeliverPane("backlog", "%19")).toBe(false);
    expect(isRealDeliverPane("skipped", "%19")).toBe(false);
    expect(isRealDeliverPane("%19", "%19")).toBe(true);
    expect(
      peerRowSentProof(
        { sent: true, sentAt: "t", deliverPane: "backlog" },
        "%19",
      ),
    ).toBe(false);
    expect(
      peerRowSentProof(
        { sent: true, sentAt: "t", deliverPane: "%19" },
        "%19",
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  formatTriageContextInject,
  isTriageBodyMessage,
  isTriageContextPeerMsg,
} from "./triage-inject.js";

describe("triage-inject", () => {
  it("detects target body and context stamp", () => {
    expect(isTriageBodyMessage("[target abc12345] SCOPE DUE: finish s13")).toBe(true);
    expect(isTriageBodyMessage("FYI only")).toBe(false);
    expect(isTriageContextPeerMsg(formatTriageContextInject([]))).toBe(true);
  });

  it("formats context with active targets", () => {
    const msg = formatTriageContextInject([
      {
        id: "tgt-abcdefgh",
        goal: "finish s13 tickets",
        deadlineAt: "2026-09-16T15:59:59.999Z",
        kind: "scope",
      },
    ]);
    expect(msg).toContain("intent=triage-context");
    expect(msg).toContain("hub targets");
    expect(msg).toContain("finish s13 tickets");
  });
});

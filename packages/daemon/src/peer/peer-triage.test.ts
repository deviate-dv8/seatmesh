import { describe, expect, it } from "vitest";
import { formatTriageContextInject } from "@seat-mesh/core";
import type { PeerRow } from "../store/create-queue-store.js";
import {
  isTriageBodyRow,
  isTriageContextRow,
  triageBodyBlockedByContext,
} from "./peer-triage.js";

describe("peer-triage FIFO gate", () => {
  const gid = "group-1";
  const context: PeerRow = {
    id: "ctx",
    at: "2026-01-01T00:00:00.000Z",
    kind: "prompt",
    fromSlot: "operator",
    fromPorts: null,
    fromAgent: "target",
    targetPane: "%1",
    targetLabel: "manager",
    msg: formatTriageContextInject([]),
    sent: false,
    triageGroupId: gid,
    peerPhase: "triage-context",
  };
  const body: PeerRow = {
    id: "body",
    at: "2026-01-01T00:00:01.000Z",
    kind: "to-slot",
    fromSlot: "operator",
    fromPorts: null,
    fromAgent: "target",
    targetPane: "%1",
    targetLabel: "manager",
    msg: "[target abc] SCOPE DUE: finish tickets",
    sent: false,
    triageGroupId: gid,
    peerPhase: "triage-body",
  };

  it("classifies rows", () => {
    expect(isTriageContextRow(context)).toBe(true);
    expect(isTriageBodyRow(body)).toBe(true);
  });

  it("blocks body until context has delivery proof", () => {
    expect(triageBodyBlockedByContext([context, body], body)).toBe(true);
    const deliveredCtx = {
      ...context,
      sent: true,
      sentAt: "2026-01-01T00:00:02.000Z",
      deliverPane: "%1",
      injectedPane: "%1",
      injectedAt: "2026-01-01T00:00:02.000Z",
    };
    expect(triageBodyBlockedByContext([deliveredCtx, body], body)).toBe(false);
  });
});

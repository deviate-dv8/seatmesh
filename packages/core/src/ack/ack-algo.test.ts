import { describe, expect, it } from "vitest";
import {
  ACK_REMIND_CAP_SEC,
  ACK_REMIND_FIRST_SEC,
  ACK_REMIND_MAX,
  ackRemindDelaySec,
  classifyPromptTick,
  closeAckRow,
  EMPTY_PROMPT_WATCH,
  extractSubmittedPrompt,
  isAckStale,
  matchFiledAcks,
  openAcksForSeat,
  remindableAcks,
  trimAsk,
} from "./ack-algo.js";
import { formatAckReminder, formatBannerAck } from "./ack-copy.js";
import type { AckRow } from "./types.js";

function row(over: Partial<AckRow> = {}): AckRow {
  return {
    id: "ack-a7f3k2ff",
    at: "2026-09-14T03:00:00.000Z",
    seat: "secretary",
    paneId: "%23",
    source: "operator",
    ask: "fix the banner overflow",
    reminders: 0,
    ...over,
  };
}

/** Claude auto-mode composer: divider-wrapped ❯ with the auto footer beneath. */
function claudeLive(draftLine: string): string {
  return [
    "✻ Baked for 35s · done 10:12 AM",
    "──────────────────────────────────────────",
    `❯ ${draftLine}`,
    "──────────────────────────────────────────",
    "  ⏵⏵ auto mode on (shift+tab to cycle)",
  ].join("\n");
}

/** Same pane one tick later: prompt committed to the transcript, composer empty. */
function claudeSubmitted(prompt: string): string {
  return [
    `> ${prompt}`,
    "⏺ working on it",
    "──────────────────────────────────────────",
    "❯ ",
    "──────────────────────────────────────────",
    "  ⏵⏵ auto mode on (shift+tab to cycle)",
  ].join("\n");
}

describe("operator prompt detection", () => {
  it("opens nothing while the operator is still typing", () => {
    const out = classifyPromptTick(
      undefined,
      { draft: "fix the banner", captureTail: claudeLive("fix the banner") },
      1_000,
    );
    expect(out.event.kind).toBe("typing");
    expect(out.next.pendingDraft).toBe("fix the banner");
  });

  it("treats draft-gone + transcript echo as a submitted prompt", () => {
    const typing = classifyPromptTick(
      undefined,
      { draft: "fix the banner overflow", captureTail: claudeLive("fix the banner overflow") },
      1_000,
    );
    const out = classifyPromptTick(
      typing.next,
      { draft: "", captureTail: claudeSubmitted("fix the banner overflow") },
      2_000,
    );
    expect(out.event).toEqual({ kind: "submitted", prompt: "fix the banner overflow" });
    expect(out.next).toEqual(EMPTY_PROMPT_WATCH);
  });

  it("treats draft-gone with no echo as abandoned (ctrl-c / backspaced)", () => {
    const typing = classifyPromptTick(
      undefined,
      { draft: "never mind this", captureTail: claudeLive("never mind this") },
      1_000,
    );
    const out = classifyPromptTick(
      typing.next,
      { draft: "", captureTail: claudeSubmitted("something else entirely") },
      2_000,
    );
    expect(out.event.kind).toBe("abandoned");
  });

  it("never tracks mesh inject copy as an operator ask", () => {
    const out = classifyPromptTick(
      undefined,
      {
        draft: "secretary | [mesh-inbox] SUPERVISE: contexts",
        captureTail: claudeLive("secretary | [mesh-inbox] SUPERVISE: contexts"),
      },
      1_000,
    );
    expect(out.event.kind).toBe("none");
    expect(out.next.pendingDraft).toBe("");
  });

  it("recovers the full prompt when the operator kept typing past the last tick", () => {
    // Daemon last saw a prefix; the committed line is longer.
    const out = classifyPromptTick(
      { pendingDraft: "fix the ban", pendingAt: 1_000 },
      { draft: "", captureTail: claudeSubmitted("fix the banner overflow on narrow panes") },
      2_000,
    );
    expect(out.event).toEqual({
      kind: "submitted",
      prompt: "fix the banner overflow on narrow panes",
    });
  });

  it("ignores echoes too short to be distinctive", () => {
    expect(extractSubmittedPrompt(claudeSubmitted("ok"), "ok")).toBe("");
  });
});

describe("reminder schedule", () => {
  it("doubles then caps", () => {
    expect(ackRemindDelaySec(0)).toBe(ACK_REMIND_FIRST_SEC);
    expect(ackRemindDelaySec(1)).toBe(ACK_REMIND_FIRST_SEC * 2);
    expect(ackRemindDelaySec(2)).toBe(ACK_REMIND_FIRST_SEC * 4);
    expect(ackRemindDelaySec(99)).toBe(ACK_REMIND_CAP_SEC);
  });

  it("stops nagging at the reminder cap but keeps the row open", () => {
    const done = row({ reminders: ACK_REMIND_MAX });
    expect(isAckStale(done)).toBe(true);
    expect(remindableAcks([done])).toEqual([]);
    expect(openAcksForSeat([done], "secretary")).toHaveLength(1);
  });

  it("drops closed rows from every open view", () => {
    const closed = closeAckRow(row(), "explicit", "restarted inbox");
    expect(closed.ackedAt).toBeTruthy();
    expect(openAcksForSeat([closed], "secretary")).toEqual([]);
    expect(isAckStale(closed)).toBe(false);
  });
});

describe("close on filing evidence", () => {
  it("pairs the oldest open row with the first later filing", () => {
    const first = row({ id: "ack-aaa111", at: "2026-09-14T03:00:00.000Z" });
    const second = row({ id: "ack-bbb222", at: "2026-09-14T03:05:00.000Z" });
    const matched = matchFiledAcks(
      [first, second],
      [{ seat: "secretary", at: "2026-09-14T03:06:00.000Z", what: "peer -> manager" }],
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]!.row.id).toBe("ack-aaa111");
    expect(matched[0]!.note).toBe("peer -> manager");
  });

  it("ignores filings that predate the ask", () => {
    const matched = matchFiledAcks(
      [row({ at: "2026-09-14T03:10:00.000Z" })],
      [{ seat: "secretary", at: "2026-09-14T03:00:00.000Z", what: "peer -> manager" }],
    );
    expect(matched).toEqual([]);
  });

  it("spends each filing on one row so a burst cannot clear a backlog", () => {
    const rows = [
      row({ id: "ack-aaa111", at: "2026-09-14T03:00:00.000Z" }),
      row({ id: "ack-bbb222", at: "2026-09-14T03:01:00.000Z" }),
      row({ id: "ack-ccc333", at: "2026-09-14T03:02:00.000Z" }),
    ];
    const matched = matchFiledAcks(rows, [
      { seat: "secretary", at: "2026-09-14T03:03:00.000Z", what: "peer -> manager" },
      { seat: "secretary", at: "2026-09-14T03:04:00.000Z", what: "room say managers" },
    ]);
    expect(matched.map((m) => m.row.id)).toEqual(["ack-aaa111", "ack-bbb222"]);
  });

  it("does not cross seats", () => {
    const matched = matchFiledAcks(
      [row({ seat: "manager" })],
      [{ seat: "secretary", at: "2026-09-14T04:00:00.000Z", what: "peer -> manager" }],
    );
    expect(matched).toEqual([]);
  });
});

describe("reminder copy", () => {
  it("lists the asks and ends on the shell line", () => {
    const text = formatAckReminder("secretary", [
      row({ id: "ack-aaa111", ask: "fix the banner overflow" }),
      row({
        id: "ack-bbb222",
        source: "peer",
        from: "manager",
        ask: "status on inbox restart",
      }),
    ]);
    expect(text).toContain("[mesh-inbox] ACK 2 unanswered");
    expect(text).toContain("· aaa111 operator: fix the banner overflow");
    expect(text).toContain("· bbb222 manager: status on inbox restart");
    // First open row is operator → ack clear; peer rows prefer --ended.
    expect(text).toMatch(/ack aaa111/);
    expect(formatAckReminder("secretary", [
      row({
        id: "ack-ccc333",
        source: "peer",
        from: "manager",
        ask: "status",
      }),
    ])).toContain("--ended ccc333");
    expect(text).toContain("queued");
  });

  it("is empty when nothing is open", () => {
    expect(formatAckReminder("secretary", [closeAckRow(row(), "explicit")])).toBe("");
  });

  it("flags stale rows in the banner", () => {
    expect(formatBannerAck(2)).toBe("ack 2");
    expect(formatBannerAck(2, 1)).toBe("ack 2!");
  });
});

describe("trimAsk", () => {
  it("collapses whitespace and caps length", () => {
    expect(trimAsk("  fix   the\nbanner  ")).toBe("fix the banner");
    expect(trimAsk("x".repeat(400)).length).toBeLessThanOrEqual(200);
  });
});

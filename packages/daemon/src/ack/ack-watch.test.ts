import { describe, expect, it, beforeEach } from "vitest";
import {
  drainOperatorPaneReplyCloses,
  drainOperatorPrompts,
  observePaneComposer,
  resetAckWatch,
} from "./ack-watch.js";

describe("ack-watch operator pane-reply close", () => {
  beforeEach(() => resetAckWatch());

  it("arms on submit then closes after busy→idle", () => {
    observePaneComposer("%1", "manager", "fix the banner overflow", "❯ fix the banner overflow\n", "typing", 1000);
    observePaneComposer(
      "%1",
      "manager",
      "",
      "> fix the banner overflow\nWorking...\n❯ \n",
      "empty",
      2000,
    );
    const prompts = drainOperatorPrompts();
    expect(prompts).toHaveLength(1);
    expect(drainOperatorPaneReplyCloses()).toEqual([]);

    observePaneComposer("%1", "manager", "", "Working...\n", "busy", 3000);
    expect(drainOperatorPaneReplyCloses()).toEqual([]);

    observePaneComposer("%1", "manager", "", "done.\n❯ \n", "empty", 4000);
    expect(drainOperatorPaneReplyCloses()).toEqual(["%1"]);
  });

  it("does not close if never busy (no false clear)", () => {
    observePaneComposer("%2", "mini-1", "hello there friend", "❯ hello there friend\n", "typing", 1000);
    observePaneComposer(
      "%2",
      "mini-1",
      "",
      "> hello there friend\n❯ \n",
      "empty",
      2000,
    );
    drainOperatorPrompts();
    observePaneComposer("%2", "mini-1", "", "❯ \n", "empty", 3000);
    expect(drainOperatorPaneReplyCloses()).toEqual([]);
  });
});

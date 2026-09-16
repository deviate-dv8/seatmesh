import { describe, expect, it } from "vitest";
import { JsonlStore } from "../store/jsonl-store.js";
import { enqueueTpJob, tpQueueAhead } from "./terminal-pool-drain.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("terminal-pool-drain", () => {
  it("enqueueTpJob appends pending row scoped to requester", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-test-"));
    const store = new JsonlStore(dir);
    const row = enqueueTpJob(store, {
      requesterSeat: "slot-1",
      requesterPane: "%12",
      cmd: "echo hi",
      summary: "test",
    });
    expect(row.status).toBe("pending");
    expect(row.requesterSeat).toBe("slot-1");
    expect(row.requesterPane).toBe("%12");
    expect(tpQueueAhead(store)).toBe(1);
    const mine = store.readTpJobs().filter((r) => r.requesterSeat === "slot-1");
    expect(mine).toHaveLength(1);
    const other = store.readTpJobs().filter((r) => r.requesterSeat === "slot-2");
    expect(other).toHaveLength(0);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reclaimOrphanOcLimitRecoveryStamp } from "./oc-limit-v2.js";

const stamp = path.join(os.tmpdir(), `sm-test-oc-limit-reclaim-${process.pid}.last`);
const inflight = path.join(os.tmpdir(), `sm-test-oc-v2-inflight-${process.pid}.json`);

describe("reclaimOrphanOcLimitRecoveryStamp", () => {
  afterEach(() => {
    fs.rmSync(stamp, { force: true });
    fs.rmSync(inflight, { force: true });
  });

  it("reclaims stamp when owner pid is dead and heartbeat stale", () => {
    fs.writeFileSync(stamp, `${Math.floor(Date.now() / 1000)}\n`);
    fs.writeFileSync(
      inflight,
      JSON.stringify({
        pid: 99999999,
        mesh: "seatmesh",
        startedAt: Date.now() - 120_000,
        heartbeatAt: Date.now() - 120_000,
      }),
    );
    const lines: string[] = [];
    expect(
      reclaimOrphanOcLimitRecoveryStamp((l) => lines.push(l), {
        stampPath: stamp,
        inflightPath: inflight,
        staleMs: 1000,
      }),
    ).toBe(true);
    expect(fs.existsSync(stamp)).toBe(false);
    expect(fs.existsSync(inflight)).toBe(false);
    expect(lines.some((l) => l.includes("orphan reclaim"))).toBe(true);
  });

  it("keeps stamp when inflight heartbeat is fresh and pid alive", () => {
    fs.writeFileSync(stamp, `${Math.floor(Date.now() / 1000)}\n`);
    fs.writeFileSync(
      inflight,
      JSON.stringify({
        pid: process.pid,
        mesh: "seatmesh",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      }),
    );
    expect(
      reclaimOrphanOcLimitRecoveryStamp(() => {}, {
        stampPath: stamp,
        inflightPath: inflight,
      }),
    ).toBe(false);
    expect(fs.existsSync(stamp)).toBe(true);
  });
});

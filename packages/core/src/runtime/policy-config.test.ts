import { describe, expect, it } from "vitest";
import {
  resolveAckRedirectDefaults,
  resolveCheckbackMaxFires,
  resolvePpaIdleSlackSec,
  resolveTargetTriageTo,
  resolveThinNotifyMinMs,
} from "./policy-config.js";
import type { MeshProfile } from "../schema/profile.js";

function bare(partial: Record<string, unknown> = {}): MeshProfile {
  return partial as unknown as MeshProfile;
}

describe("policy-config", () => {
  it("resolves engine defaults when profile omits keys", () => {
    const p = bare({});
    expect(resolvePpaIdleSlackSec(p)).toBe(120);
    expect(resolveAckRedirectDefaults(p)).toEqual({
      ttlMin: 45,
      ttlMs: 45 * 60_000,
      rewriteTo: "secretary",
      block: "*managers",
    });
    expect(resolveTargetTriageTo(p)).toEqual(["manager", "secretary"]);
    expect(resolveCheckbackMaxFires(p)).toBe(3);
    expect(resolveThinNotifyMinMs(p)).toBe(5 * 60 * 1000);
  });

  it("honors user overrides", () => {
    const p = bare({
      ppa: { idleSlackSec: 90 },
      acks: { redirect: { ttlMin: 10, rewriteTo: "manager", block: "manager" } },
      targets: { triageTo: ["secretary"] },
      chatRooms: {
        root: "chat-rooms",
        globalSlug: "global",
        checkback: {
          duration: "5m",
          renew: "3m",
          maxFires: 7,
          callPending: { duration: "1m", renew: "1m" },
        },
        thinNotify: { minInterval: "2m" },
      },
    });
    expect(resolvePpaIdleSlackSec(p)).toBe(90);
    expect(resolveAckRedirectDefaults(p).ttlMin).toBe(10);
    expect(resolveAckRedirectDefaults(p).rewriteTo).toBe("manager");
    expect(resolveTargetTriageTo(p)).toEqual(["secretary"]);
    expect(resolveCheckbackMaxFires(p)).toBe(7);
    expect(resolveThinNotifyMinMs(p)).toBe(2 * 60 * 1000);
  });
});

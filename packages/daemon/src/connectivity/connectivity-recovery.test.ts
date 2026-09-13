import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearOcLimitBannerForPane,
  maybeEndRateLimitEpisode,
  newConnectivityRecoveryState,
  shouldChainRotateUntilAfterSmart,
  shouldNotifyProxyDownStuck,
  smartRestartCooldownLeftSec,
  updateIpifyProbeStreak,
  updatePaneConnectStreak,
  updateRateLimitEpisode,
} from "./connectivity-recovery.js";

describe("updateIpifyProbeStreak (debounce shallow ipify failures)", () => {
  it("does not confirm down on the first failure", () => {
    const state = newConnectivityRecoveryState();
    const r = updateIpifyProbeStreak(state, false, 3);
    expect(r.confirmedDown).toBe(false);
    expect(r.streak).toBe(1);
  });

  it("confirms down only after threshold consecutive failures", () => {
    const state = newConnectivityRecoveryState();
    updateIpifyProbeStreak(state, false, 3);
    updateIpifyProbeStreak(state, false, 3);
    const r = updateIpifyProbeStreak(state, false, 3);
    expect(r.confirmedDown).toBe(true);
    expect(r.streak).toBe(3);
  });

  it("resets streak when carrier is ok again", () => {
    const state = newConnectivityRecoveryState();
    updateIpifyProbeStreak(state, false, 3);
    updateIpifyProbeStreak(state, true, 3);
    expect(state.ipifyFailStreak).toBe(0);
    const r = updateIpifyProbeStreak(state, false, 3);
    expect(r.confirmedDown).toBe(false);
    expect(r.streak).toBe(1);
  });
});

describe("updatePaneConnectStreak (PROXY-DOWN scrollback debounce)", () => {
  it("does not confirm connect on first observation", () => {
    const m = new Map<string, number>();
    const r = updatePaneConnectStreak(m, "%1", true, 15);
    expect(r.confirmed).toBe(false);
    expect(r.streak).toBe(1);
  });

  it("confirms only after threshold consecutive observations", () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      updatePaneConnectStreak(m, "%1", true, 15);
    }
    const r = updatePaneConnectStreak(m, "%1", true, 15);
    expect(r.confirmed).toBe(true);
    expect(r.streak).toBe(15);
  });

  it("resets when the pane no longer shows connect errors", () => {
    const m = new Map<string, number>();
    updatePaneConnectStreak(m, "%1", true, 15);
    updatePaneConnectStreak(m, "%1", false, 15);
    expect(m.has("%1")).toBe(false);
  });
});

describe("updateRateLimitEpisode (OC-LIMIT rising-edge/episode)", () => {
  it("starts an episode on the first rate-limited pane", () => {
    const state = newConnectivityRecoveryState();
    const r = updateRateLimitEpisode(state, true, 1_000);
    expect(r.action).toBe("start");
    expect(state.rateLimitEpisodeActive).toBe(true);
    expect(state.lastRateLimitSeenAt).toBe(1_000);
  });

  it("does not re-trigger while the episode is already active (no re-arm loop)", () => {
    const state = newConnectivityRecoveryState();
    updateRateLimitEpisode(state, true, 1_000);
    const r = updateRateLimitEpisode(state, true, 2_000);
    expect(r.action).toBe("continue");
    expect(state.lastRateLimitSeenAt).toBe(2_000);
  });

  it("does not clear immediately when limited panes disappear (flicker grace)", () => {
    const state = newConnectivityRecoveryState();
    updateRateLimitEpisode(state, true, 1_000);
    const r = updateRateLimitEpisode(state, false, 1_500, 120_000);
    expect(r.action).toBe("none");
    expect(state.rateLimitEpisodeActive).toBe(true);
  });

  it("clears the episode once the grace period has elapsed with no limited panes", () => {
    const state = newConnectivityRecoveryState();
    updateRateLimitEpisode(state, true, 1_000);
    const r = updateRateLimitEpisode(state, false, 1_000 + 120_001, 120_000);
    expect(r.action).toBe("clear");
    expect(state.rateLimitEpisodeActive).toBe(false);
  });

  it("newConnectivityRecoveryState includes rateLimitRecoveryStarted false", () => {
    expect(newConnectivityRecoveryState().rateLimitRecoveryStarted).toBe(false);
  });

  it("is a no-op when never armed and still no limit", () => {
    const state = newConnectivityRecoveryState();
    const r = updateRateLimitEpisode(state, false, 1_000);
    expect(r.action).toBe("none");
  });
});

describe("shouldChainRotateUntilAfterSmart (Proxy-SMART -> rotate-until chaining)", () => {
  it("chains when Proxy-SMART skipped on cooldown (exit 2)", () => {
    expect(
      shouldChainRotateUntilAfterSmart({ exitCode: 2, ipBefore: "1.2.3.4", ipAfter: "1.2.3.4" }),
    ).toBe(true);
  });

  it("chains when the carrier IP failed to resolve after SMART", () => {
    expect(
      shouldChainRotateUntilAfterSmart({ exitCode: 0, ipBefore: "1.2.3.4", ipAfter: null }),
    ).toBe(true);
  });

  it("chains when the carrier IP is unchanged (SMART no-op)", () => {
    expect(
      shouldChainRotateUntilAfterSmart({ exitCode: 0, ipBefore: "1.2.3.4", ipAfter: "1.2.3.4" }),
    ).toBe(true);
  });

  it("chains when SMART exited non-zero for any other reason", () => {
    expect(
      shouldChainRotateUntilAfterSmart({ exitCode: 1, ipBefore: "1.2.3.4", ipAfter: "5.6.7.8" }),
    ).toBe(true);
  });

  it("does NOT chain when SMART succeeded and rotated the carrier IP", () => {
    expect(
      shouldChainRotateUntilAfterSmart({ exitCode: 0, ipBefore: "1.2.3.4", ipAfter: "5.6.7.8" }),
    ).toBe(false);
  });
});

describe("shouldNotifyProxyDownStuck (PROXY-DOWN silence fix)", () => {
  it("does not notify before an episode has started", () => {
    const state = newConnectivityRecoveryState();
    expect(shouldNotifyProxyDownStuck(state, 1_000, 120_000)).toBe(false);
  });

  it("does not notify before the threshold elapses", () => {
    const state = newConnectivityRecoveryState();
    state.proxyDownEpisodeStartAt = 1_000;
    expect(shouldNotifyProxyDownStuck(state, 1_000 + 119_999, 120_000)).toBe(false);
  });

  it("notifies once the threshold elapses", () => {
    const state = newConnectivityRecoveryState();
    state.proxyDownEpisodeStartAt = 1_000;
    expect(shouldNotifyProxyDownStuck(state, 1_000 + 120_000, 120_000)).toBe(true);
  });

  it("never re-fires once already notified for this episode", () => {
    const state = newConnectivityRecoveryState();
    state.proxyDownEpisodeStartAt = 1_000;
    state.proxyDownStuckNotified = true;
    expect(shouldNotifyProxyDownStuck(state, 1_000 + 999_999, 120_000)).toBe(false);
  });
});

describe("clearOcLimitBannerForPane", () => {
  it("removes pane from ocLimited and ends episode when cache empty", () => {
    const state = newConnectivityRecoveryState();
    state.ocLimited.add("%9");
    state.rateLimitEpisodeActive = true;
    state.rateLimitRecoveryStarted = true;
    expect(clearOcLimitBannerForPane(state, "%9")).toBe(true);
    expect(state.ocLimited.has("%9")).toBe(false);
    maybeEndRateLimitEpisode(state);
    expect(state.rateLimitEpisodeActive).toBe(false);
    expect(state.rateLimitRecoveryStarted).toBe(false);
  });
});

describe("smartRestartCooldownLeftSec (harness-parity stamp file)", () => {
  const tmpStamp = path.join(os.tmpdir(), `sm-test-smart-restart-${process.pid}.last`);

  it("returns 0 when the stamp file does not exist", () => {
    expect(smartRestartCooldownLeftSec(tmpStamp, 1800, 1_000_000)).toBe(0);
  });

  it("returns seconds left when within the cooldown window", () => {
    const nowSec = 1_000_000;
    fs.writeFileSync(tmpStamp, String(nowSec - 100));
    try {
      expect(smartRestartCooldownLeftSec(tmpStamp, 1800, nowSec * 1000)).toBe(1700);
    } finally {
      fs.rmSync(tmpStamp, { force: true });
    }
  });

  it("returns 0 once the cooldown window has fully elapsed", () => {
    const nowSec = 1_000_000;
    fs.writeFileSync(tmpStamp, String(nowSec - 1800));
    try {
      expect(smartRestartCooldownLeftSec(tmpStamp, 1800, nowSec * 1000)).toBe(0);
    } finally {
      fs.rmSync(tmpStamp, { force: true });
    }
  });
});

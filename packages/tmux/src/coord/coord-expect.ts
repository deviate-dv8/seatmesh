import {
  armCommsCheckbackSync,
  chatRoomConfigForLoaded,
  isHumanCoTypedColumn,
  sayInRoomSync,
  type LoadedProfile,
} from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { parseSeatTarget } from "../seats/seat-paths.js";
import { readSeatSnapshot } from "../seats/seat-update.js";
import { runAssign } from "../seats/seat-assign.js";

const COORD_EXPECT_PREFIX = "coord-expect";

export function formatCoordExpect(
  target: string,
  hub: string,
  snippet: string,
): string {
  const sn = snippet.replace(/\s+/g, " ").trim().slice(0, 160);
  return `${COORD_EXPECT_PREFIX} ${target} ${hub} ${sn}`;
}

export function parseCoordExpect(expect: string): {
  target: string;
  hub: string;
  snippet: string;
} | null {
  const m = expect.match(/^coord-expect\s+(\S+)\s+(\S+)\s+(.+)$/s);
  if (!m) return null;
  return { target: m[1], hub: m[2], snippet: m[3].trim() };
}

export function extractHubToken(text: string): string | null {
  const fq = text.match(/\bFQ[- ]?(\d+)\b/i);
  if (fq) return `FQ${fq[1]}`;
  const issue = text.match(/#\s*(\d+)/);
  if (issue) return `#${issue[1]}`;
  return null;
}

/** Seat files show hub work started or finished. */
export function verifyCoordExpectMet(loaded: LoadedProfile, target: string, hub: string): boolean {
  let seatTarget;
  try {
    seatTarget = parseSeatTarget(target);
  } catch {
    return false;
  }
  const snap = readSeatSnapshot(loaded, seatTarget);
  if (!snap) return false;
  const blob = `${snap.focus.text}\n${snap.tasks.text}`;
  if (!blob.includes(hub)) return false;
  if (new RegExp(`-\\s*\\[x\\][^\\n]*${hub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(snap.tasks.text)) {
    return true;
  }
  if (
    /\b(PROG|PROVED|PASS|DONE|collected)\b/i.test(snap.focus.text) &&
    blob.includes(hub)
  ) {
    return true;
  }
  return false;
}

export function postAssignRoomNotice(loaded: LoadedProfile, target: string, text: string): void {
  try {
    const cfg = chatRoomConfigForLoaded(loaded);
    sayInRoomSync(loaded.workspace, cfg, "managers", "assign", `ASSIGNED: ${text} -> ${target}`, {
      kind: "status",
      expectReply: false,
    });
  } catch {
    /* room optional */
  }
}

export function armCoordExpectAfterAssign(
  loaded: LoadedProfile,
  opts: { target: string; assignText: string; duration?: string; renew?: string },
): void {
  const hub = extractHubToken(opts.assignText) ?? "hub";
  const mgr = resolvePaneTarget("manager", loaded);
  if ("error" in mgr) return;
  const cfg = chatRoomConfigForLoaded(loaded);
  const expect = formatCoordExpect(opts.target, hub, opts.assignText);
  armCommsCheckbackSync({
    cfg,
    ownerPane: mgr.paneId,
    expect,
    kind: "coord-expect",
    duration: opts.duration ?? "5m",
    renew: opts.renew ?? "3m",
    senderPane: mgr.paneId,
  });
}

export function handleCoordExpectDue(
  loaded: LoadedProfile,
  expect: string,
): { met: boolean; retried: boolean; reason: string } {
  const parsed = parseCoordExpect(expect);
  if (!parsed) return { met: false, retried: false, reason: "bad_expect" };
  if (verifyCoordExpectMet(loaded, parsed.target, parsed.hub)) {
    return { met: true, retried: false, reason: "verified" };
  }
  const retryText = `COORD EXPECT stale on ${parsed.hub}: ${parsed.snippet} — execute now (tick-only; read FOCUS/TASK + BALANCE-LAST)`;
  try {
    runAssign(loaded, parsed.target, retryText);
    postAssignRoomNotice(loaded, parsed.target, retryText);
    return { met: false, retried: true, reason: "re-assign" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { met: false, retried: false, reason: msg };
  }
}

export function isHumanCoTypedTarget(loaded: LoadedProfile, targetRaw: string): boolean {
  const col = targetRaw.trim().toLowerCase();
  return isHumanCoTypedColumn(col, loaded.profile.layout);
}

/**
 * Canonical user-facing inject / supervise copy for seat-mesh (single source).
 * Daemon + secretary + CLI templates import from here — do not duplicate prose elsewhere.
 * Never paste patterns.md or role file lists into a pane inject.
 */

import { seatmeshCmd } from "./cli-hints.js";

/** Always-on dots point here. .sm/roles is whoami-only — not loaded every turn. */
export const AGENT_PROMPT = {
  constsFile: "services/seat-mesh/packages/core/src/messages/mesh-copy.ts",
  nowFile: "~/.config/zsign/MESH-NOW.md",
  durableFile: "~/.config/zsign/MESH-DURABLE.md",
  noPatternsInInject: "never paste patterns.md into an inject",
} as const;

/** Required prefix on every inbox-daemon inject (SUPERVISE, BALANCE, Check:, peer drain). */
export const MESH_INBOX_TAG = "[mesh-inbox]";
export const MESH_INBOX_ROOM_TAG = "[mesh-inbox-room]";
export const MESH_SECRETARY_PREFIX = "[mesh-secretary] ";

export const BALANCE_CHECKBACK = {
  balanceLeadTickExpect:
    "balance tick — pull work from main lead; nudge idle balancee with open TASKS; update BALANCE-LAST",
  balanceStatusExpect: "BALANCE-STATUS — rebalance or pull from manager if needed",
} as const;

export const SUPERVISE_CHECKBACK = {
  managerNudgeExpect: "manager idle — complete open TASKS.md checkboxes",
  secretarySuperviseExpect:
    "supervise all manager columns — nudge idle lead on open TASKS; ignore stale mini DIGEST",
  meshWatchExpect: "mesh MINI-DONE / health change / STALE thought-only minis",
  /** After daemon STATUS inject — poll-later; not an inbox row. */
  statusExpect: "SUPERVISE-STATUS — next open TASK or Mark OPEN",
} as const;

export type CoordLeadRole = string;

export function seatFocusTasksPath(role: CoordLeadRole): string {
  return `seats/${role}`;
}

/** Daemon CONTINUE inject when a coord lead pane is idle. */
export function meshInboxContinueLead(role: CoordLeadRole): string {
  const seat = seatFocusTasksPath(role);
  return (
    `${MESH_INBOX_TAG} CONTINUE: read ${seat}/FOCUS.md + ${seat}/TASKS.md only (hub from assign — never hand-edit peer seats); ` +
    "work the next open TASK checkbox (no operator yes/continue); Mark OPEN only when session TASKS are clear"
  );
}

/** Mechanical STATUS posted by the daemon to every manager-kind lead. */
export function formatSuperviseStatusLine(
  leads: Array<{ id: string; mark: string; open: number }>,
): string {
  return leads.map((l) => `${l.id} ${l.mark} ${l.open} open`).join(" | ");
}

export function meshInboxSuperviseStatus(line: string): string {
  return `${MESH_INBOX_TAG} SUPERVISE-STATUS: ${line}`;
}

/** Ledger / fan-out / PEER drain: supervise STATUS must not rich-inject the manager lead. */
export function isSuperviseStatusBroadcast(kind: string | undefined, body: string): boolean {
  if (kind === "status") return true;
  const t = body.trim();
  if (/^STATUS\b/i.test(t)) return true;
  if (/SUPERVISE-STATUS\b/i.test(t)) return true;
  if (/\[mesh-inbox-room\][^\n]*\|\s*status\b/i.test(t)) return true;
  if (/\nSTATUS\b/i.test(t)) return true;
  return false;
}

/** One-line mechanical balance STATUS (main lead + balancees). */
export function formatBalanceStatusLine(opts: {
  mainLeadId: string;
  mainMark: string;
  mainOpen: number;
  balanceeParts: string[];
}): string {
  const tail =
    opts.balanceeParts.length > 0 ? opts.balanceeParts.join(" | ") : "(no balancees)";
  return `${opts.mainLeadId} ${opts.mainMark} ${opts.mainOpen} open || ${tail}`;
}

export function meshInboxBalanceStatus(line: string): string {
  return `${MESH_INBOX_TAG} BALANCE-STATUS: ${line}`;
}

/** Balance lead tick inject — best-effort; daemon already posted room STATUS + auto-assign. */
export function meshInboxBalanceLeadTick(): string {
  return (
    `${MESH_INBOX_TAG} BALANCE: Daemon tick wrote BALANCE-LAST + room STATUS + auto-assign when pull applies. ` +
    "Read the balance-lead seat BALANCE-LAST.md and managers/balance rooms; execute assigned TASK — no manual peer pull. " +
    `One-shot METHOD: \`${seatmeshCmd("balance run")}\`. Off: \`${seatmeshCmd("balance off")}\`.`
  );
}

export function balanceLeadBrief(opts: { interval: string; balancees: string[] }): string {
  const list = opts.balancees.join(", ") || "(none)";
  return (
    `BALANCE ON interval=${opts.interval} balancees=${list}. ` +
    "Every tick: BALANCE-LAST + room STATUS + auto-assign on pull (daemon METHOD). " +
    `\`${seatmeshCmd("balance run")}\` for one tick. Off: \`${seatmeshCmd("balance off")}\``
  );
}

/** Secretary SUPERVISE tick inject — one pane per interval; do not spam manager. */
export function meshInboxSuperviseSecretaryTick(): string {
  return (
    `${MESH_INBOX_TAG} SUPERVISE: ${seatmeshCmd("contexts")}. Seats are .sm/seats/<column-id> ` +
    "(not tasks/agent-seats). Read .sm/seats/secretary/SUPERVISE-LAST.md; " +
    "compare TASKS/FOCUS/room PROG/minis. Room STATUS at most once per supervise interval unless " +
    `material change — ALWAYS \`${seatmeshCmd('room say -r managers --kind status "..."')}\` (the --kind flag ` +
    "is required: coordinator panes get the full message body pasted in unless it's tagged status, " +
    "which floods them on every tick). Peer nudge leads only when no progress since last snapshot " +
    "(not every drain). Idle+open TASK -> one CONTINUE. Update SUPERVISE-LAST.md after tick. " +
    "No shell scripts."
  );
}

/** Prefix for formatMeshSteeringInject / manager digest blocks. */
export function meshInboxDigestBlock(digestText: string): string {
  return `${MESH_INBOX_TAG} DIGEST: ${digestText}`;
}

export function meshInboxDigestIncomplete(opts: {
  done: number;
  total: number;
  openIds: number[];
}): string {
  const open = opts.openIds.join(",") || "none";
  return (
    `${MESH_INBOX_TAG} DIGEST INCOMPLETE: ${opts.done}/${opts.total} open=[${open}] — ` +
    seatmeshCmd("secretary collect --nudge")
  );
}

export function secretaryDigestPrompt(digestText: string): string {
  return `SECRETARY-DIGEST (mechanical — do not trust chat "all done"):\n${digestText}`;
}

/** Inject body for seatmesh assign — hub already written to FOCUS/TASKS. */
export function assignPrompt(target: string, text: string): string {
  return (
    `ASSIGN ${target}. Hub is your FOCUS NOW (written by ${seatmeshCmd(`assign ${target} …`)} — do not wait for a hand-edit). ` +
    `First: ${seatmeshCmd("whoami")}. Then: ${text.trim()}`
  );
}

/** First inject on every fresh launch / switch / restart. Agent runs whoami itself. */
export function freshSummonWhoamiPrompt(role?: string): string {
  const who = role ? ` You are ${role}.` : "";
  return (
    `FRESH SUMMON.${who} First action: run ${seatmeshCmd("whoami")} (no flags). ` +
    "That dump is your role, seat files, FOCUS, TASKS, and hub. Then do that hub. " +
    "A later peer is a task — you already know the seat. Do not ask the operator who you are."
  );
}

/** Restart / first-paint brief — keep short so OpenCode does not enter Shell with a novel. */
export function secretaryColdStartBrief(): string {
  return (
    `${freshSummonWhoamiPrompt("SECRETARY")} ` +
    "Seats=.sm/seats/<column-id> (every profile base column). " +
    `Tick: ${seatmeshCmd("contexts")}; if a lead is idle with open TASKS, ${seatmeshCmd("peer <lead> CONTINUE one checkbox")}. ` +
    "Never write or run a long shell script. Never peer --direct. mesh-watch OFF."
  );
}

/** One-shot brief pasted to secretary when supervise arms. */
export function secretarySuperviseBrief(opts: {
  managerPane: string;
  interval: string;
  extraPanes?: Array<{ id: string; paneId: string }>;
}): string {
  const extras = (opts.extraPanes ?? []).map((e) => `${e.id}=${e.paneId}`).join("+");
  const paneList = [opts.managerPane, extras].filter(Boolean).join("+");
  return (
    `SUPERVISE ON interval=${opts.interval} panes=${paneList}. ` +
    "Every tick: contexts + lead TASKS + minis; room STATUS at most once per interval unless change. " +
    "Compare .sm/seats/secretary/SUPERVISE-LAST.md — no progress -> peer nudge (not spam). " +
    `Idle lead with open TASKS -> ${seatmeshCmd("peer CONTINUE one checkbox")}. ` +
    "Never write or run a long shell script. Never peer --direct."
  );
}

/** Room verify tail suffix (FOCUS/TASKS hub). */
export const ROOM_VERIFY_CONTINUE_HUB =
  "(no chat reply — continue FOCUS/TASKS hub)";

/**
 * Drop mesh-owned inject/banner lines before composer/limit scoring.
 * Leftover `OC-LIMIT:` / `[mesh-inbox]` after a CLI type-switch must not
 * count as a live provider limit.
 */
export function stripMeshOwnedLines(tail: string): string {
  return tail
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/\[mesh-inbox/.test(t)) return false;
      if (/\bOC-LIMIT:/.test(t)) return false;
      return true;
    })
    .join("\n");
}

/**
 * Temporary ACK redirect blocks.
 * After a lead redirects replies to secretary, ACK-class peers from a seat
 * to the wrong recipient (usually manager) are rewritten to secretary so
 * minis cannot n+1 spam the old target.
 */
import fs from "node:fs";
import path from "node:path";
import { isManagerKind, isSecretaryKind, stripPeerStamps } from "@seat-mesh/core";
import type { LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "@seat-mesh/tmux";
import { isAckClassPeer } from "./peer-backlog.js";
import type { PeerRow } from "../store/create-queue-store.js";

/**
 * Redirect-eligible = chit-chat ACK/FYI/closing only. PROVED/DONE/CLAIMED/etc are
 * also `isAckClassPeer` (skip unanswered-ask tracking), but carry real proof that
 * must still land on the intended recipient — never silently reroute those.
 */
const REDIRECT_ACK_ONLY_RE =
  /^(ACK|FYI|STAND-?BY|BUSY|MCP-?SYNCED|CHECKBACK\?|Noted|Thanks|Thank you|closing\b|got it\b|ok\b)/i;

export const ACK_REDIRECT_DEFAULT_TTL_MS = 45 * 60_000;

export interface AckRedirectBlock {
  id: string;
  /** Sender seat that must not hit blockTarget (e.g. mini-1). */
  fromSeat: string;
  /** Wrong recipient to block (manager / manager-2 / *managers). */
  blockTarget: string;
  /** Where to send instead (usually secretary). */
  rewriteTo: string;
  untilMs: number;
  armedBy: string;
  at: string;
  reason?: string;
}

function blocksPath(stateDir: string): string {
  return path.join(stateDir, "ACK-REDIRECT-BLOCKS.json");
}

function readBlocks(stateDir: string): AckRedirectBlock[] {
  const p = blocksPath(stateDir);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { blocks?: AckRedirectBlock[] };
    return Array.isArray(raw.blocks) ? raw.blocks : [];
  } catch {
    return [];
  }
}

function writeBlocks(stateDir: string, blocks: AckRedirectBlock[]): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    blocksPath(stateDir),
    `${JSON.stringify({ blocks }, null, 2)}\n`,
    "utf8",
  );
}

/** Normalize mini-1 / worker-2 / slot-2 / manager-2 to stable seat keys. */
export function normalizeRedirectSeat(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!s) return "";
  const mini = s.match(/^(?:mini|manager-mini)-?(\d+)$/);
  if (mini) return `mini-${mini[1]}`;
  const worker = s.match(/^(?:worker|slot)-?(\d+)$/);
  if (worker) return `worker-${worker[1]}`;
  if (/^\d+$/.test(s)) return `worker-${s}`;
  if (s === "master") return "manager";
  return s;
}

export function senderSeatFromPeer(row: {
  fromAgent?: string | null;
  fromSlot?: string | null;
}): string {
  const agent = normalizeRedirectSeat(row.fromAgent ?? "");
  if (agent.startsWith("mini-") || agent.startsWith("worker-")) return agent;
  if (agent && !agent.includes(":")) return agent;
  const slot = String(row.fromSlot ?? "").trim();
  if (!slot || slot === "?") return agent || "";
  return normalizeRedirectSeat(slot);
}

function pruneExpired(blocks: AckRedirectBlock[], nowMs: number): AckRedirectBlock[] {
  return blocks.filter((b) => b.untilMs > nowMs);
}

export function listAckRedirectBlocks(
  stateDir: string,
  nowMs = Date.now(),
): AckRedirectBlock[] {
  const live = pruneExpired(readBlocks(stateDir), nowMs);
  if (live.length !== readBlocks(stateDir).length) writeBlocks(stateDir, live);
  return live;
}

export function armAckRedirectBlock(
  stateDir: string,
  opts: {
    fromSeat: string;
    blockTarget?: string;
    rewriteTo?: string;
    ttlMs?: number;
    armedBy?: string;
    reason?: string;
    nowMs?: number;
  },
): AckRedirectBlock {
  const nowMs = opts.nowMs ?? Date.now();
  const fromSeat = normalizeRedirectSeat(opts.fromSeat);
  if (!fromSeat) throw new Error("fromSeat required");
  const blockTarget = normalizeRedirectSeat(opts.blockTarget ?? "*managers") || "*managers";
  const rewriteTo = normalizeRedirectSeat(opts.rewriteTo ?? "secretary") || "secretary";
  const ttlMs = Math.max(60_000, opts.ttlMs ?? ACK_REDIRECT_DEFAULT_TTL_MS);
  let blocks = pruneExpired(readBlocks(stateDir), nowMs);
  // One active block per from+blockTarget — refresh TTL on re-arm.
  blocks = blocks.filter(
    (b) => !(b.fromSeat === fromSeat && b.blockTarget === blockTarget && b.rewriteTo === rewriteTo),
  );
  const row: AckRedirectBlock = {
    id: `arb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    fromSeat,
    blockTarget,
    rewriteTo,
    untilMs: nowMs + ttlMs,
    armedBy: opts.armedBy ?? "coord",
    at: new Date(nowMs).toISOString(),
    reason: opts.reason,
  };
  blocks.push(row);
  writeBlocks(stateDir, blocks);
  return row;
}

export function clearAckRedirectBlocks(
  stateDir: string,
  opts: { id?: string; fromSeat?: string } = {},
): number {
  const nowMs = Date.now();
  let blocks = pruneExpired(readBlocks(stateDir), nowMs);
  const before = blocks.length;
  if (opts.id) blocks = blocks.filter((b) => b.id !== opts.id);
  else if (opts.fromSeat) {
    const from = normalizeRedirectSeat(opts.fromSeat);
    blocks = blocks.filter((b) => b.fromSeat !== from);
  } else {
    blocks = [];
  }
  writeBlocks(stateDir, blocks);
  return before - blocks.length;
}

function targetIsBlocked(blockTarget: string, targetLabel: string): boolean {
  const t = normalizeRedirectSeat(targetLabel);
  const b = normalizeRedirectSeat(blockTarget);
  if (!t || !b) return false;
  if (b === "*managers" || b === "managers") {
    return isManagerKind(t) || t === "master";
  }
  if (b === t) return true;
  // manager block also catches manager-2 when kinds align
  if (b === "manager" && isManagerKind(t)) return true;
  return false;
}

export function findAckRedirectBlock(
  stateDir: string,
  fromSeat: string,
  targetLabel: string,
  nowMs = Date.now(),
): AckRedirectBlock | null {
  const from = normalizeRedirectSeat(fromSeat);
  if (!from) return null;
  for (const b of listAckRedirectBlocks(stateDir, nowMs)) {
    if (b.fromSeat !== from) continue;
    if (!targetIsBlocked(b.blockTarget, targetLabel)) continue;
    // Never rewrite if already going to rewriteTo
    if (normalizeRedirectSeat(targetLabel) === b.rewriteTo) continue;
    if (isSecretaryKind(targetLabel) && b.rewriteTo === "secretary") continue;
    return b;
  }
  return null;
}

export interface AckRedirectApplyResult {
  redirected: boolean;
  block?: AckRedirectBlock;
  fromLabel?: string;
  toLabel?: string;
}

/**
 * If this is ACK-class mail from a blocked sender to a blocked target,
 * rewrite targetLabel/targetPane to rewriteTo (secretary).
 */
export function applyAckRedirectBlock(
  stateDir: string,
  loaded: LoadedProfile,
  row: PeerRow,
  nowMs = Date.now(),
): AckRedirectApplyResult {
  if (!isAckClassPeer(row.msg)) return { redirected: false };
  if (!REDIRECT_ACK_ONLY_RE.test(stripPeerStamps(row.msg))) return { redirected: false };

  const from = senderSeatFromPeer(row);
  const block = findAckRedirectBlock(stateDir, from, row.targetLabel || "", nowMs);
  if (!block) return { redirected: false };

  const resolved = resolvePaneTarget(block.rewriteTo, loaded);
  if ("error" in resolved) return { redirected: false };

  const fromLabel = row.targetLabel;
  row.targetLabel = block.rewriteTo;
  row.targetPane = resolved.paneId;
  if (!/\[ack-redirect:/i.test(row.msg)) {
    row.msg = `[ack-redirect:${fromLabel}→${block.rewriteTo}] ${row.msg}`;
  }
  return { redirected: true, block, fromLabel, toLabel: block.rewriteTo };
}

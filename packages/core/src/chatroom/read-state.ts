import fs from "node:fs";
import path from "node:path";
import type { RoomMessage } from "./types.js";
import type { ChatRoomConfig } from "./room.js";
import { roomDir, roomLogPath } from "./room.js";
import { RoomMessageSchema } from "./types.js";

export interface AgentReadCursor {
  lastReadId?: string;
  lastReadTs?: string;
  /** Last thin room-ping unseen count (dedupe flood when unread pile does not grow). */
  lastThinNotifyUnseen?: number;
  lastThinNotifyAt?: string;
}

export type RoomReadState = Record<string, AgentReadCursor>;

function readStatePath(roomPath: string): string {
  return path.join(roomPath, "read-state.json");
}

export function loadRoomReadState(roomPath: string): RoomReadState {
  const p = readStatePath(roomPath);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as RoomReadState;
  } catch {
    return {};
  }
}

export function saveRoomReadState(roomPath: string, state: RoomReadState): void {
  fs.mkdirSync(roomPath, { recursive: true });
  fs.writeFileSync(readStatePath(roomPath), JSON.stringify(state, null, 2) + "\n");
}

function parseRow(row: unknown): RoomMessage | null {
  const parsed = RoomMessageSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

function listRoomMessagesSync(file: string): RoomMessage[] {
  if (!fs.existsSync(file)) return [];
  const out: RoomMessage[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = parseRow(JSON.parse(trimmed));
      if (row) out.push(row);
    } catch {
      /* skip bad row */
    }
  }
  return out;
}

export function listRoomMessages(workspace: string, cfg: ChatRoomConfig, slug: string): RoomMessage[] {
  const file = roomLogPath(roomDir(workspace, cfg, slug));
  return listRoomMessagesSync(file);
}

/** Latest ledger `from` that is not `excludeFrom` (Check paste names this sender). */
export function lastInboundRoomFrom(
  messages: RoomMessage[],
  excludeFrom: string,
): string | null {
  const self = excludeFrom.trim();
  for (let i = messages.length - 1; i >= 0; i--) {
    const from = messages[i]?.from?.trim();
    if (from && from !== self) return from;
  }
  return null;
}

export function countUnseenMessages(
  messages: RoomMessage[],
  agentId: string,
  cursor: AgentReadCursor | undefined,
): number {
  const afterTs = cursor?.lastReadTs ?? "";
  const afterId = cursor?.lastReadId ?? "";
  return messages.filter((m) => {
    if (m.from === agentId) return false;
    if (afterTs && m.ts > afterTs) return true;
    if (afterId && m.id !== afterId && m.ts === afterTs) return true;
    if (!afterTs && !afterId) return true;
    return false;
  }).length;
}

export function markRoomRead(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  agentId: string,
): { marked: number; cursor: AgentReadCursor } {
  const dir = roomDir(workspace, cfg, slug);
  const messages = listRoomMessages(workspace, cfg, slug);
  const state = loadRoomReadState(dir);
  const before = countUnseenMessages(messages, agentId, state[agentId]);
  const last = messages.at(-1);
  const cursor: AgentReadCursor = last
    ? { lastReadId: last.id, lastReadTs: last.ts }
    : { lastReadTs: new Date().toISOString() };
  state[agentId] = cursor;
  saveRoomReadState(dir, state);
  return { marked: before, cursor };
}

export function unseenSummaryForAgent(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  agentId: string,
): number {
  const dir = roomDir(workspace, cfg, slug);
  const messages = listRoomMessages(workspace, cfg, slug);
  const state = loadRoomReadState(dir);
  return countUnseenMessages(messages, agentId, state[agentId]);
}

/**
 * Skip thin room pings on a per-agent cooldown.
 * Do NOT key off unseen growth — busy rooms grow unseen on every FYI and that
 * made the old "skip when unseen not grown" check never fire (UNSENT flood).
 */
export function shouldSkipThinRoomNotify(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  agentId: string,
  unseen: number,
  nowMs: number = Date.now(),
): boolean {
  if (unseen <= 0) return true;
  const dir = roomDir(workspace, cfg, slug);
  const state = loadRoomReadState(dir);
  const cur = state[agentId];
  if (!cur?.lastThinNotifyAt) return false;
  const age = nowMs - Date.parse(cur.lastThinNotifyAt);
  if (!Number.isFinite(age) || age < 0) return false;
  return age < (cfg.thinNotifyMinMs ?? 5 * 60 * 1000);
}

export function recordThinRoomNotify(
  workspace: string,
  cfg: ChatRoomConfig,
  slug: string,
  agentId: string,
  unseen: number,
  nowMs: number = Date.now(),
): void {
  const dir = roomDir(workspace, cfg, slug);
  const state = loadRoomReadState(dir);
  const prev = state[agentId] ?? {};
  state[agentId] = {
    ...prev,
    lastThinNotifyUnseen: unseen,
    lastThinNotifyAt: new Date(nowMs).toISOString(),
  };
  saveRoomReadState(dir, state);
}

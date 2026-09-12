import fs from "node:fs";
import path from "node:path";
import type { RoomMessage } from "./types.js";
import type { ChatRoomConfig } from "./room.js";
import { roomDir, roomLogPath } from "./room.js";
import { RoomMessageSchema } from "./types.js";

export interface AgentReadCursor {
  lastReadId?: string;
  lastReadTs?: string;
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

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LoadedProfile } from "../profile/profile.js";
import { meshRuntimePaths } from "../paths/runtime-paths.js";

export type RoomCallStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface RoomCallRow {
  id: string;
  shortId: string;
  status: RoomCallStatus;
  roomSlug: string;
  fromAgent: string;
  toAgent: string;
  fromSlot: string;
  toSlot: string;
  topic: string;
  createdAt: string;
  resolvedAt?: string;
  declineReason?: string;
}

export function callsPath(loaded: LoadedProfile): string {
  return meshRuntimePaths(loaded).callsJsonl;
}

function readCallsFile(file: string): RoomCallRow[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RoomCallRow);
}

function writeCallsFile(file: string, rows: RoomCallRow[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function peerRoomSlug(slotA: string, slotB: string, shortId: string): string {
  const [lo, hi] = [slotA, slotB].sort((a, b) => Number(a) - Number(b));
  return `peer-${lo}-${hi}-${shortId}`;
}

export function createPendingCall(
  loaded: LoadedProfile,
  input: {
    fromAgent: string;
    toAgent: string;
    fromSlot: string;
    toSlot: string;
    topic: string;
  },
): RoomCallRow {
  const file = callsPath(loaded);
  const rows = readCallsFile(file);
  const pending = rows.find(
    (r) =>
      r.status === "pending" &&
      ((r.fromAgent === input.fromAgent && r.toAgent === input.toAgent) ||
        (r.fromAgent === input.toAgent && r.toAgent === input.fromAgent)),
  );
  if (pending) {
    throw new Error(
      `pending call already exists: ${pending.shortId} (${pending.fromAgent} -> ${pending.toAgent})`,
    );
  }

  const id = randomUUID();
  const shortId = id.replace(/-/g, "").slice(0, 8);
  const row: RoomCallRow = {
    id,
    shortId,
    status: "pending",
    roomSlug: peerRoomSlug(input.fromSlot, input.toSlot, shortId),
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    fromSlot: input.fromSlot,
    toSlot: input.toSlot,
    topic: input.topic.trim(),
    createdAt: new Date().toISOString(),
  };
  rows.push(row);
  writeCallsFile(file, rows);
  return row;
}

export function findCallByShortId(loaded: LoadedProfile, shortId: string): RoomCallRow | null {
  const needle = shortId.trim().toLowerCase();
  if (!needle) return null;
  const rows = readCallsFile(callsPath(loaded));
  return (
    rows.find((r) => r.shortId === needle || r.id.startsWith(needle) || r.id === needle) ?? null
  );
}

export function updateCall(loaded: LoadedProfile, row: RoomCallRow): void {
  const file = callsPath(loaded);
  const rows = readCallsFile(file);
  const i = rows.findIndex((r) => r.id === row.id);
  if (i < 0) throw new Error(`call not found: ${row.id}`);
  rows[i] = row;
  writeCallsFile(file, rows);
}

export function listCallsForAgent(loaded: LoadedProfile, agentId: string): RoomCallRow[] {
  return readCallsFile(callsPath(loaded)).filter(
    (r) => r.fromAgent === agentId || r.toAgent === agentId,
  );
}

export function listPendingCallsForAgent(loaded: LoadedProfile, agentId: string): RoomCallRow[] {
  return listCallsForAgent(loaded, agentId).filter((r) => r.status === "pending");
}

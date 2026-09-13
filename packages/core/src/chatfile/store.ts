import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { MeshProfile } from "../schema/profile.js";
import { resolveFromWorkspace } from "../paths/paths.js";
import { resolveHarnessPath } from "../paths/paths-manifest.js";
import type { LoadedProfile } from "../profile/profile.js";
import { appendJsonlLine, readJsonlAll, readJsonlTail } from "../jsonl/store.js";
import { SlotPromptRecordSchema, type PromptQuery, type SlotPromptRecord } from "./types.js";

export interface ChatFileConfig {
  root: string;
  rootAbs?: string;
  filename: string;
}

export function chatFileConfig(profile: MeshProfile): ChatFileConfig {
  const cf = profile.chatFiles;
  return {
    root: cf?.root ?? "chat-files",
    filename: cf?.filename ?? "CHAT.jsonl",
  };
}

export function chatFileConfigForLoaded(loaded: LoadedProfile): ChatFileConfig {
  const cfg = chatFileConfig(loaded.profile);
  return { ...cfg, rootAbs: resolveHarnessPath(loaded, cfg.root) };
}

export function chatFilePath(workspace: string, cfg: ChatFileConfig, slotKey: string): string {
  const root = cfg.rootAbs ?? resolveFromWorkspace(workspace, cfg.root);
  return path.join(root, slotKey, cfg.filename);
}

export function turnHash(input: {
  sessionId?: string;
  humanPrompt: string;
  agentResponse?: string;
}): string {
  const raw = `${input.sessionId ?? ""}\n${input.humanPrompt}\n${input.agentResponse ?? ""}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function parseRecord(row: unknown): SlotPromptRecord | null {
  const parsed = SlotPromptRecordSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export async function appendSlotPrompt(
  workspace: string,
  cfg: ChatFileConfig,
  record: Omit<SlotPromptRecord, "id" | "ts" | "turnHash"> & { id?: string; ts?: string },
): Promise<SlotPromptRecord> {
  const hash = turnHash({
    sessionId: record.sessionId,
    humanPrompt: record.humanPrompt,
    agentResponse: record.agentResponse,
  });
  const file = chatFilePath(workspace, cfg, record.slot);
  const existing = fs.existsSync(file)
    ? await readJsonlTail(file, 200, parseRecord)
    : [];
  if (existing.some((r) => r.turnHash === hash)) {
    const prior = existing.find((r) => r.turnHash === hash)!;
    return prior;
  }

  const row: SlotPromptRecord = SlotPromptRecordSchema.parse({
    id: record.id ?? randomUUID(),
    ts: record.ts ?? new Date().toISOString(),
    turnHash: hash,
    ...record,
  });
  await appendJsonlLine(file, row);
  return row;
}

export async function tailSlotPrompts(
  workspace: string,
  cfg: ChatFileConfig,
  slotKey: string,
  lines = 50,
): Promise<SlotPromptRecord[]> {
  const file = chatFilePath(workspace, cfg, slotKey);
  if (!fs.existsSync(file)) return [];
  return readJsonlTail(file, lines, parseRecord);
}

export async function querySlotPrompts(
  workspace: string,
  cfg: ChatFileConfig,
  query: PromptQuery,
): Promise<SlotPromptRecord[]> {
  const root = resolveFromWorkspace(workspace, cfg.root);
  if (!fs.existsSync(root)) return [];

  const slots = query.slot
    ? [query.slot]
    : fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  let rows: SlotPromptRecord[] = [];
  for (const slot of slots) {
    const file = chatFilePath(workspace, cfg, slot);
    if (!fs.existsSync(file)) continue;
    rows = rows.concat(await readJsonlAll(file, parseRecord));
  }

  rows = rows.filter((r) => {
    if (query.providerId && r.providerId !== query.providerId) return false;
    if (query.sessionId && r.sessionId !== query.sessionId) return false;
    if (query.model && r.model !== query.model) return false;
    if (query.since && Date.parse(r.ts) < Date.parse(query.since)) return false;
    return true;
  });

  rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const limit = query.limit ?? 100;
  return rows.slice(-limit);
}

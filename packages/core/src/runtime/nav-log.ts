/**
 * Navigation history — `sm nav log|summary` (TODO 3.6). Appended on `peek <target>`
 * (the existing "look at a pane" primitive) — not on switch/attach/pane-resume,
 * which are provisioning actions, not pure navigation. Best-effort: a logging
 * failure never breaks the caller.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { appendJsonlLine, readJsonlTail } from "../jsonl/store.js";
import { meshRuntimePaths } from "../paths/runtime-paths.js";
import type { LoadedProfile } from "../profile/profile.js";

export const NavEntrySchema = z.object({
  at: z.string(),
  actor: z.string(),
  target: z.string(),
  targetPane: z.string(),
  role: z.string().optional(),
  slot: z.string().optional(),
});
export type NavEntry = z.infer<typeof NavEntrySchema>;

function parseNavRow(row: unknown): NavEntry | null {
  const parsed = NavEntrySchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export async function appendNavEntry(
  loaded: LoadedProfile,
  entry: {
    actor: string;
    target: string;
    targetPane: string;
    role?: string;
    slot?: string;
    at?: string;
  },
): Promise<void> {
  const file = meshRuntimePaths(loaded).navJsonl;
  const row: NavEntry = {
    at: entry.at ?? new Date().toISOString(),
    actor: entry.actor,
    target: entry.target,
    targetPane: entry.targetPane,
    role: entry.role,
    slot: entry.slot,
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await appendJsonlLine(file, row);
  } catch {
    /* nav logging is best-effort */
  }
}

export async function tailNavLog(loaded: LoadedProfile, lines = 50): Promise<NavEntry[]> {
  const file = meshRuntimePaths(loaded).navJsonl;
  if (!fs.existsSync(file)) return [];
  return readJsonlTail(file, lines, parseNavRow);
}

export interface NavSummaryRow {
  target: string;
  count: number;
  lastAt: string;
}

/** Most-recently-visited target first. */
export function summarizeNavEntries(entries: NavEntry[]): NavSummaryRow[] {
  const byTarget = new Map<string, NavSummaryRow>();
  for (const e of entries) {
    const existing = byTarget.get(e.target);
    if (!existing) {
      byTarget.set(e.target, { target: e.target, count: 1, lastAt: e.at });
    } else {
      existing.count++;
      if (e.at > existing.lastAt) existing.lastAt = e.at;
    }
  }
  return [...byTarget.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

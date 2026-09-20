/**
 * `sm campaign ...` — ticket-style campaigns (TODO 8.2/8.4). Deliberately the
 * narrowest slice of the campaign-contract vision (see
 * docs/HANDOUT-CAMPAIGN-CONTRACT.md): one atomic unit of work with a title, an
 * objective (what "done" means), a status, and an optional assignee. No slice
 * dependency graph, no supervisor/balancer roles, no persona-model changes — those
 * are explicitly open product questions in the design doc, not implemented here.
 *
 * Purely additive: new CLI surface + new event log, zero interaction with
 * supervise/balance/room/task/role code. A mesh that never runs `sm campaign`
 * behaves exactly as before.
 *
 * Event-sourced (append-only jsonl, same pattern as nav-log.ts), reduced to
 * current state on read — lets `campaign note <id> "…"` build a lightweight
 * progress history for free, without a separate CRUD file to keep in sync.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { appendJsonlLine, readJsonlAll } from "../jsonl/store.js";
import { meshRuntimePaths } from "../paths/runtime-paths.js";
import type { LoadedProfile } from "../profile/profile.js";

export const CAMPAIGN_STATUSES = ["open", "done", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CampaignEventSchema = z.object({
  at: z.string(),
  kind: z.enum(["create", "assign", "status", "note"]),
  id: z.string(),
  by: z.string().optional(),
  title: z.string().optional(),
  objective: z.string().optional(),
  assignee: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  note: z.string().optional(),
});
export type CampaignEvent = z.infer<typeof CampaignEventSchema>;

export interface CampaignRecord {
  id: string;
  title: string;
  objective?: string;
  status: CampaignStatus;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  doneAt?: string;
  notes: { at: string; by?: string; note: string }[];
}

function parseCampaignEvent(row: unknown): CampaignEvent | null {
  const parsed = CampaignEventSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export function newCampaignId(): string {
  return `cmp-${randomBytes(4).toString("hex")}`;
}

async function appendCampaignEvent(loaded: LoadedProfile, event: CampaignEvent): Promise<void> {
  const file = meshRuntimePaths(loaded).campaignsJsonl;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await appendJsonlLine(file, event);
}

/** Fold the event log into current-state records, oldest first per id. */
export function reduceCampaignEvents(events: CampaignEvent[]): Map<string, CampaignRecord> {
  const byId = new Map<string, CampaignRecord>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.kind === "create") {
      if (byId.has(e.id)) continue; // duplicate create — ignore, first wins
      byId.set(e.id, {
        id: e.id,
        title: e.title ?? "(untitled)",
        objective: e.objective,
        status: "open",
        assignee: e.assignee,
        createdAt: e.at,
        updatedAt: e.at,
        notes: [],
      });
      continue;
    }
    const rec = byId.get(e.id);
    if (!rec) continue; // event for an id with no create row — ignore
    rec.updatedAt = e.at;
    if (e.kind === "assign") rec.assignee = e.assignee;
    if (e.kind === "status" && e.status) {
      rec.status = e.status;
      if (e.status === "done") rec.doneAt = e.at;
    }
    if (e.kind === "note" && e.note) rec.notes.push({ at: e.at, by: e.by, note: e.note });
  }
  return byId;
}

export async function readCampaigns(loaded: LoadedProfile): Promise<CampaignRecord[]> {
  const file = meshRuntimePaths(loaded).campaignsJsonl;
  const events = await readJsonlAll(file, parseCampaignEvent);
  return [...reduceCampaignEvents(events).values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function findCampaign(
  loaded: LoadedProfile,
  id: string,
): Promise<CampaignRecord | null> {
  const all = await readCampaigns(loaded);
  return all.find((c) => c.id === id) ?? null;
}

export async function createCampaign(
  loaded: LoadedProfile,
  opts: { title: string; objective?: string; assignee?: string; by?: string },
): Promise<CampaignRecord> {
  const id = newCampaignId();
  const at = new Date().toISOString();
  await appendCampaignEvent(loaded, {
    at,
    kind: "create",
    id,
    title: opts.title,
    objective: opts.objective,
    assignee: opts.assignee,
    by: opts.by,
  });
  return {
    id,
    title: opts.title,
    objective: opts.objective,
    status: "open",
    assignee: opts.assignee,
    createdAt: at,
    updatedAt: at,
    notes: [],
  };
}

export async function assignCampaign(
  loaded: LoadedProfile,
  id: string,
  assignee: string,
  by?: string,
): Promise<void> {
  await appendCampaignEvent(loaded, { at: new Date().toISOString(), kind: "assign", id, assignee, by });
}

export async function setCampaignStatus(
  loaded: LoadedProfile,
  id: string,
  status: CampaignStatus,
  by?: string,
): Promise<void> {
  await appendCampaignEvent(loaded, { at: new Date().toISOString(), kind: "status", id, status, by });
}

export async function noteCampaign(
  loaded: LoadedProfile,
  id: string,
  note: string,
  by?: string,
): Promise<void> {
  await appendCampaignEvent(loaded, { at: new Date().toISOString(), kind: "note", id, note, by });
}

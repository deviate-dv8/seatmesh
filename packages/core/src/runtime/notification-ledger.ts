import fs from "node:fs";
import { randomBytes } from "node:crypto";

export type NotificationKind = "link" | "eyes" | "info" | "yesno" | "desktop";

export type NotificationStatus = "sent" | "acted" | "expired";

export interface NotificationLink {
  label: string;
  token?: string;
  url: string;
}

/** Persisted operator/agent notify — sibling to ephemeral in-memory act cards. */
export interface NotificationRow {
  id: string;
  sessionId: string;
  sessionName: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  check?: string;
  fromSeat?: string;
  targetSeat?: string;
  url?: string;
  infoUrl?: string;
  cardId?: string;
  links?: NotificationLink[];
  status: NotificationStatus;
  createdAt: string;
  expiresAt?: string;
  actedAt?: string;
  actedLabel?: string;
}

export interface NotificationSummary {
  sent: number;
  acted: number;
  expired: number;
  updatedAt: string | null;
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      /* skip */
    }
  }
  return out;
}

function writeJsonl<T>(file: string, rows: T[]): void {
  const dir = file.replace(/[/\\][^/\\]+$/, "");
  if (dir && dir !== file) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function newNotificationId(): string {
  return `ntf-${randomBytes(4).toString("hex")}`;
}

export function readNotifications(file: string): NotificationRow[] {
  return readJsonl<NotificationRow>(file);
}

export function writeNotifications(file: string, rows: NotificationRow[]): void {
  writeJsonl(file, rows);
}

export function upsertNotification(file: string, row: NotificationRow): NotificationRow {
  const rows = readNotifications(file).filter((r) => r.id !== row.id);
  rows.push(row);
  writeNotifications(file, rows);
  return row;
}

export function summarizeNotifications(rows: NotificationRow[]): NotificationSummary {
  let sent = 0;
  let acted = 0;
  let expired = 0;
  let updatedAt: string | null = null;
  const now = Date.now();
  for (const r of rows) {
    let status = r.status;
    if (status === "sent" && r.expiresAt && Date.parse(r.expiresAt) <= now) {
      status = "expired";
    }
    if (status === "sent") sent++;
    else if (status === "acted") acted++;
    else if (status === "expired") expired++;
    if (!updatedAt || r.createdAt > updatedAt) updatedAt = r.createdAt;
  }
  return { sent, acted, expired, updatedAt };
}

export function listNotifications(
  file: string,
  opts?: { all?: boolean; kind?: NotificationKind; limit?: number },
): NotificationRow[] {
  let rows = readNotifications(file);
  if (!opts?.all) {
    rows = rows.filter((r) => {
      if (r.status === "acted" || r.status === "expired") return false;
      if (r.expiresAt && Date.parse(r.expiresAt) <= Date.now()) return false;
      return r.status === "sent";
    });
  }
  if (opts?.kind) rows = rows.filter((r) => r.kind === opts.kind);
  rows = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts?.limit != null && opts.limit > 0) rows = rows.slice(0, opts.limit);
  return rows;
}

export function recordNotification(
  file: string,
  input: Omit<NotificationRow, "id" | "createdAt" | "status"> & {
    id?: string;
    status?: NotificationStatus;
    createdAt?: string;
  },
): NotificationRow {
  const now = input.createdAt ?? new Date().toISOString();
  const row: NotificationRow = {
    id: input.id ?? newNotificationId(),
    sessionId: input.sessionId,
    sessionName: input.sessionName,
    kind: input.kind,
    title: input.title.trim() || "Notify",
    body: input.body?.trim() || undefined,
    check: input.check?.trim() || undefined,
    fromSeat: input.fromSeat?.trim() || undefined,
    targetSeat: input.targetSeat?.trim() || undefined,
    url: input.url?.trim() || undefined,
    infoUrl: input.infoUrl?.trim() || undefined,
    cardId: input.cardId?.trim() || undefined,
    links: input.links?.length ? input.links : undefined,
    status: input.status ?? "sent",
    createdAt: now,
    expiresAt: input.expiresAt,
    actedAt: input.actedAt,
    actedLabel: input.actedLabel,
  };
  return upsertNotification(file, row);
}

export function markNotificationActed(
  file: string,
  opts: { id?: string; cardId?: string; actToken?: string; label?: string },
): NotificationRow | null {
  const rows = readNotifications(file);
  const now = new Date().toISOString();
  let hit: NotificationRow | undefined;
  if (opts.id) {
    hit = rows.find((r) => r.id === opts.id);
  } else if (opts.cardId) {
    hit = rows.find((r) => r.cardId === opts.cardId && r.status === "sent");
  } else if (opts.actToken) {
    hit = rows.find(
      (r) =>
        r.status === "sent" &&
        r.links?.some((l) => l.token && l.token === opts.actToken),
    );
  }
  if (!hit) return null;
  hit.status = "acted";
  hit.actedAt = now;
  hit.actedLabel = opts.label?.trim() || hit.actedLabel;
  writeNotifications(file, rows);
  return hit;
}

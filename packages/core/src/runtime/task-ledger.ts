import fs from "node:fs";
import { randomBytes } from "node:crypto";

/** Per-seat agent task — structured sibling to TASKS.md checkboxes. */
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export type TaskSource = "add" | "assign" | "give";

export interface TaskRow {
  id: string;
  sessionId: string;
  sessionName: string;
  seat: string;
  text: string;
  status: TaskStatus;
  source: TaskSource;
  assignedBy?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskSessionSummary {
  open: number;
  inProgress: number;
  done: number;
  cancelled: number;
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
      /* skip bad line */
    }
  }
  return out;
}

function writeJsonl<T>(file: string, rows: T[]): void {
  const dir = file.replace(/[/\\][^/\\]+$/, "");
  if (dir && dir !== file) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function newTaskId(): string {
  return `task-${randomBytes(4).toString("hex")}`;
}

export function readTasks(file: string): TaskRow[] {
  return readJsonl<TaskRow>(file);
}

export function writeTasks(file: string, rows: TaskRow[]): void {
  writeJsonl(file, rows);
}

export function upsertTask(file: string, row: TaskRow): TaskRow {
  const rows = readTasks(file).filter((r) => r.id !== row.id);
  rows.push(row);
  writeTasks(file, rows);
  return row;
}

export function findTask(file: string, id: string): TaskRow | null {
  const needle = id.trim().toLowerCase();
  if (!needle) return null;
  return (
    readTasks(file).find((r) => r.id === id || r.id.toLowerCase().startsWith(needle)) ?? null
  );
}

export function findOpenTaskBySeatText(
  file: string,
  seat: string,
  text: string,
): TaskRow | null {
  const wantSeat = seat.trim();
  const wantText = text.trim().toLowerCase();
  if (!wantSeat || !wantText) return null;
  return (
    readTasks(file).find(
      (r) =>
        r.seat === wantSeat &&
        r.status === "open" &&
        (r.text.trim().toLowerCase() === wantText || r.text.toLowerCase().includes(wantText)),
    ) ?? null
  );
}

export function summarizeTasks(rows: TaskRow[]): TaskSessionSummary {
  let open = 0;
  let inProgress = 0;
  let done = 0;
  let cancelled = 0;
  let updatedAt: string | null = null;
  for (const r of rows) {
    if (r.status === "open") open++;
    else if (r.status === "in_progress") inProgress++;
    else if (r.status === "done") done++;
    else if (r.status === "cancelled") cancelled++;
    if (!updatedAt || r.updatedAt > updatedAt) updatedAt = r.updatedAt;
  }
  return { open, inProgress, done, cancelled, updatedAt };
}

export function listTasks(
  file: string,
  opts?: { seat?: string; status?: TaskStatus | "active"; all?: boolean },
): TaskRow[] {
  let rows = readTasks(file);
  if (opts?.seat) rows = rows.filter((r) => r.seat === opts.seat);
  if (!opts?.all) {
    if (opts?.status === "active") {
      rows = rows.filter((r) => r.status === "open" || r.status === "in_progress");
    } else if (opts?.status) {
      rows = rows.filter((r) => r.status === opts.status);
    } else {
      rows = rows.filter((r) => r.status === "open" || r.status === "in_progress");
    }
  }
  return [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function recordTaskOpen(
  file: string,
  opts: {
    sessionId: string;
    sessionName: string;
    seat: string;
    text: string;
    source: TaskSource;
    assignedBy?: string;
  },
): TaskRow {
  const body = opts.text.trim();
  if (!body) throw new Error("task text empty");
  const existing = findOpenTaskBySeatText(file, opts.seat, body);
  if (existing) return existing;

  const now = new Date().toISOString();
  const row: TaskRow = {
    id: newTaskId(),
    sessionId: opts.sessionId,
    sessionName: opts.sessionName,
    seat: opts.seat.trim(),
    text: body,
    status: "open",
    source: opts.source,
    assignedBy: opts.assignedBy?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  return upsertTask(file, row);
}

export function markTaskDoneByMatch(
  file: string,
  seat: string,
  matchText: string,
): TaskRow | null {
  const row = findOpenTaskBySeatText(file, seat, matchText);
  if (!row) return null;
  const now = new Date().toISOString();
  row.status = "done";
  row.updatedAt = now;
  row.completedAt = now;
  if (!row.startedAt) row.startedAt = row.createdAt;
  return upsertTask(file, row);
}

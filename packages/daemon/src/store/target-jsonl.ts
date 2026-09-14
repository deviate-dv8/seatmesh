import fs from "node:fs";

/** Operator self-deadline (EOD) — sibling to checkback, not pane poll-later. */
export interface TargetRow {
  id: string;
  status: "active" | "done" | "cancelled";
  goal: string;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  /**
   * scope = whole operator goal (e.g. "s13 remaining tickets") — leads break it down.
   * slice = workable child with its own deadline under a scope.
   */
  kind?: "scope" | "slice";
  /** Parent scope id when kind=slice. */
  parentId?: string;
  /** Last operator toast fire. */
  remindedAt?: string;
  /** Last triage peer to manager/secretary. */
  triageAt?: string;
  /** Seats to peer when due / on triage — default manager+secretary. */
  triageTo?: string[];
  source?: "operator";
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
  fs.mkdirSync(pathDirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

function pathDirname(file: string): string {
  const i = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return i >= 0 ? file.slice(0, i) : ".";
}

export function readTargets(file: string): TargetRow[] {
  return readJsonl<TargetRow>(file);
}

export function writeTargets(file: string, rows: TargetRow[]): void {
  writeJsonl(file, rows);
}

export function upsertTarget(file: string, row: TargetRow): TargetRow {
  const rows = readTargets(file).filter((r) => r.id !== row.id);
  rows.push(row);
  writeTargets(file, rows);
  return row;
}

export function findTarget(file: string, id: string): TargetRow | null {
  const needle = String(id || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    readTargets(file).find((r) => r.id === id || r.id.toLowerCase().startsWith(needle)) ?? null
  );
}

export function markTargetStatus(
  file: string,
  id: string,
  status: "done" | "cancelled",
): TargetRow | null {
  const row = findTarget(file, id);
  if (!row) return null;
  if (row.status !== "active") return row;
  row.status = status;
  row.updatedAt = new Date().toISOString();
  return upsertTarget(file, row);
}

/** Cancel prior active targets with the same normalized goal. */
export function cancelActiveTargetsWithGoal(file: string, goal: string): number {
  const want = goal.trim().toLowerCase();
  if (!want) return 0;
  const rows = readTargets(file);
  const now = new Date().toISOString();
  let n = 0;
  for (const r of rows) {
    if (r.status !== "active") continue;
    if (r.goal.trim().toLowerCase() !== want) continue;
    r.status = "cancelled";
    r.updatedAt = now;
    n++;
  }
  if (n) writeTargets(file, rows);
  return n;
}

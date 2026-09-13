import fs from "node:fs";
import {
  isCoordKind,
  isManagerKind,
  loadRoleIndex,
  profilePaths,
  renderRoleIndex,
  secretaryColdStartBrief,
  type LoadedProfile,
} from "@seat-mesh/core";
import type { WhoamiResult } from "../agents/whoami.js";
import { gateQueuePath, seatDirFor, seatFile, type SeatTarget } from "./seat-paths.js";

const MAX_FOCUS = 2400;
const MAX_QUEUE = 3200;
const MAX_TASKS = 1200;

export function openTaskLines(tasksPath: string): string[] {
  if (!fs.existsSync(tasksPath)) return [];
  const out: string[] = [];
  let inOpen = false;
  for (const line of fs.readFileSync(tasksPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (/^##\s+open/i.test(t)) {
      inOpen = true;
      continue;
    }
    if (inOpen && /^##\s+/.test(t)) break;
    if (inOpen && t.startsWith("- [ ]")) out.push(t);
  }
  return out;
}

function readTrimmed(file: string, max: number): string {
  if (!fs.existsSync(file)) return `(missing: ${file})`;
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return `(empty: ${file})`;
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}

export function roleKindForWhoami(w: WhoamiResult): string {
  if (w.role === "manager-mini") return "mini";
  if (w.role === "secretary" || w.role.startsWith("secretary-")) return w.role;
  if (isManagerKind(w.role)) return w.role;
  return "worker";
}

function whoamiSeatTarget(w: WhoamiResult, mini: string | null): SeatTarget {
  if (w.role === "manager-mini" || mini) {
    return { role: "manager-mini", mini: mini ?? null };
  }
  if (isCoordKind(w.role)) return { role: w.role };
  const slot = w.slotLabel ?? (w.slot != null ? String(w.slot) : null);
  return { role: "worker", slot };
}

function activeGateRows(queueText: string): string[] {
  const rows: string[] = [];
  for (const line of queueText.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    if (line.includes("---") || line.includes("Slice")) continue;
    const upper = line.toUpperCase();
    if (
      upper.includes("**OPEN**") ||
      upper.includes("**BLOCKED**") ||
      upper.includes("| OPEN |") ||
      upper.includes("| BLOCKED |")
    ) {
      rows.push(line.trim());
    }
  }
  return rows;
}

/** Single canonical briefing — embed in whoami, cold-start inject, handoff. */
export function buildColdStartBrief(
  loaded: LoadedProfile,
  w: WhoamiResult,
  opts: { mini?: string | null } = {},
): string {
  if (w.role === "secretary") return secretaryColdStartBrief();
  const mini = opts.mini ?? null;
  const target = whoamiSeatTarget(w, mini);
  const seatDir = seatDirFor(loaded, target);
  const focusPath = seatFile(loaded, target, "FOCUS.md");
  const tasksPath = seatFile(loaded, target, "TASKS.md");
  const queuePath = gateQueuePath(loaded);

  const lines: string[] = [];
  lines.push(
    "COLD-START — work from files below; inbox ping = tail once, NO chat reply",
    `queue=${queuePath}`,
  );
  if (seatDir) lines.push(`seat=${seatDir}`);
  if (focusPath) lines.push(`focus=${focusPath}`);
  if (tasksPath) lines.push(`tasks=${tasksPath}`);

  lines.push("", "--- GATE-QUEUE (active) ---");
  if (fs.existsSync(queuePath)) {
    const q = fs.readFileSync(queuePath, "utf8");
    const active = activeGateRows(q);
    if (active.length) {
      for (const row of active) lines.push(row);
    } else {
      lines.push(readTrimmed(queuePath, MAX_QUEUE));
    }
  } else {
    lines.push(`(missing ${queuePath} — run ./sm.sh seat init)`);
  }

  if (focusPath) {
    lines.push("", `--- FOCUS (${pathLabel(focusPath)}) ---`);
    lines.push(readTrimmed(focusPath, MAX_FOCUS));
  }

  if (tasksPath) {
    const open = openTaskLines(tasksPath);
    lines.push("", `--- OPEN TASKS (${pathLabel(tasksPath)}) ---`);
    lines.push(open.length ? open.join("\n") : "(none — Mark OPEN if session done)");
  }

  lines.push(
    "",
    "RULES: ./sm.sh whoami every turn | update TASKS checkbox | row minis -> lead not manager",
  );

  return lines.join("\n");
}

/** Role index (banner + read_first + policies + files) plus hub — same material as ./sm.sh whoami inject path. */
export function buildFullColdStartBrief(
  loaded: LoadedProfile,
  w: WhoamiResult,
  opts: { mini?: string | null; jobRole?: string } = {},
): string {
  if (w.role === "secretary") return secretaryColdStartBrief();
  const parts: string[] = [];
  const paths = profilePaths(loaded);
  const kind = roleKindForWhoami(w);
  const mini = opts.mini ?? "";
  const jobRole = opts.jobRole ?? "";

  try {
    const index = loadRoleIndex(paths.rolesDir, kind);
    const roleBlock = renderRoleIndex(index, { mini, jobRole });
    if (roleBlock.trim()) {
      parts.push(roleBlock.trim());
    }
  } catch {
    /* role yaml optional in tests */
  }

  parts.push(buildColdStartBrief(loaded, w, { mini }));
  return parts.join("\n\n");
}

function pathLabel(abs: string): string {
  const i = abs.indexOf("tasks/");
  return i >= 0 ? abs.slice(i) : abs;
}

export function printColdStart(
  loaded: LoadedProfile,
  w: WhoamiResult,
  opts: { mini?: string | null } = {},
): void {
  console.log("--- cold-start ---");
  console.log(buildColdStartBrief(loaded, w, opts));
}

import fs from "node:fs";
import path from "node:path";
import type { LoadedProfile } from "@seat-mesh/core";
import { seatDirFor, type SeatTarget } from "./seat-paths.js";

export type FocusMark = "OPEN" | "BUSY" | "BLOCKED";

export interface SeatSnapshot {
  dir: string;
  focus: { text: string; mark: string | null; updatedStamp: string | null; nowPreview: string };
  tasks: { text: string; open: number; done: number };
  reminder: { text: string; open: number };
}

function readOr(p: string, fallback = ""): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : fallback;
}

function countPrefixed(text: string, prefix: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith(prefix)) n++;
  }
  return n;
}

/** Same trimming rules as the old contexts.ts focusPreview() — kept verbatim. */
export function focusPreview(text: string, n = 2): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("**Tmux seat:**") && s.includes("(fill")) continue;
    if (s.startsWith("<!--")) continue;
    out.push(s);
    if (out.length >= n) break;
  }
  return out.length ? out.join(" | ").slice(0, 56) : "(no FOCUS body)";
}

function parseFocusField(text: string, label: string): string | null {
  const m = text.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

/** Structured read of a seat's FOCUS/TASKS/REMINDER trio. Null if the seat dir can't resolve. */
export function readSeatSnapshot(loaded: LoadedProfile, target: SeatTarget): SeatSnapshot | null {
  const dir = seatDirFor(loaded, target);
  if (!dir) return null;

  const focusText = readOr(path.join(dir, "FOCUS.md"));
  const tasksText = readOr(path.join(dir, "TASKS.md"));
  const reminderText = readOr(path.join(dir, "REMINDER.md"));

  return {
    dir,
    focus: {
      text: focusText,
      mark: parseFocusField(focusText, "Mark"),
      updatedStamp: parseFocusField(focusText, "Updated"),
      nowPreview: focusText ? focusPreview(focusText) : "(no FOCUS.md)",
    },
    tasks: {
      text: tasksText,
      open: countPrefixed(tasksText, "- [ ]"),
      done: countPrefixed(tasksText, "- [x]"),
    },
    reminder: {
      text: reminderText,
      open: countPrefixed(reminderText, "- [ ]"),
    },
  };
}

function atomicWrite(p: string, body: string): void {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, p);
}

function requireSeatFile(loaded: LoadedProfile, target: SeatTarget, name: string): string {
  const dir = seatDirFor(loaded, target);
  if (!dir) throw new Error(`seat-update: cannot resolve seat dir for target ${JSON.stringify(target)}`);
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    throw new Error(`seat-update: ${p} does not exist — run seat-init first`);
  }
  return p;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Replace FOCUS.md ## NOW, set Mark BUSY, bump Updated. Do not hand-edit FOCUS. */
export function setFocusNow(loaded: LoadedProfile, target: SeatTarget, nowText: string): void {
  const p = requireSeatFile(loaded, target, "FOCUS.md");
  let text = fs.readFileSync(p, "utf8");
  const nowBody = nowText.trim();
  if (!nowBody) throw new Error("seat-update: NOW text empty");
  if (/^\*\*Mark:\*\*/m.test(text)) {
    text = text.replace(/^\*\*Mark:\*\*.*$/m, "**Mark:** BUSY");
  } else {
    text = `**Mark:** BUSY\n${text}`;
  }
  if (/^\*\*Updated:\*\*/m.test(text)) {
    text = text.replace(/^\*\*Updated:\*\*.*$/m, `**Updated:** ${todayStamp()}`);
  } else {
    text = text.replace(/^\*\*Mark:\*\*.*$/m, (m) => `${m}\n**Updated:** ${todayStamp()}`);
  }
  const block = `## NOW\n\n${nowBody}\n`;
  if (/^## NOW\s*$/m.test(text)) {
    const after = text.search(/^## NOW\s*$/m);
    const rest = text.slice(after);
    const next = rest.search(/\n## /);
    text =
      next === -1
        ? `${text.slice(0, after)}${block}`
        : `${text.slice(0, after)}${block}\n${rest.slice(next + 1)}`;
  } else {
    text = `${text.replace(/\s*$/, "")}\n\n${block}`;
  }
  atomicWrite(p, text);
}

/** Flip FOCUS.md's **Mark:** line and bump **Updated:** to today. Throws if FOCUS.md is missing. */
export function setFocusMark(loaded: LoadedProfile, target: SeatTarget, mark: FocusMark): void {
  const p = requireSeatFile(loaded, target, "FOCUS.md");
  let text = fs.readFileSync(p, "utf8");
  text = text.replace(/^\*\*Mark:\*\*.*$/m, `**Mark:** ${mark}`);
  text = text.replace(/^\*\*Updated:\*\*.*$/m, `**Updated:** ${todayStamp()}`);
  atomicWrite(p, text);
}

/** Append a new open checkbox under TASKS.md's "## Open" section. Throws if TASKS.md is missing. */
export function appendTask(loaded: LoadedProfile, target: SeatTarget, text: string): void {
  const p = requireSeatFile(loaded, target, "TASKS.md");
  let body = fs.readFileSync(p, "utf8");
  const line = `- [ ] ${text.trim()}`;
  if (body.includes(line)) return;

  const openHeading = /^## Open\s*$/m;
  if (openHeading.test(body)) {
    // Strip a lone "(none)" placeholder inside the Open section before adding a real task.
    body = body.replace(/^## Open\s*\n+\(none\)\s*$/m, "## Open");
    const updated = body.replace(openHeading, (m) => `${m}\n\n${line}`);
    atomicWrite(p, updated);
    return;
  }
  atomicWrite(p, `${body.replace(/\s*$/, "")}\n\n## Open\n\n${line}\n`);
}

/**
 * Flip the first open TASKS.md line containing matchText to done and move it under
 * "## Done (recent)" with today's date. Returns false (no write) if no match found.
 */
export function checkTask(loaded: LoadedProfile, target: SeatTarget, matchText: string): boolean {
  const p = requireSeatFile(loaded, target, "TASKS.md");
  const body = fs.readFileSync(p, "utf8");
  const lines = body.split(/\r?\n/);

  const idx = lines.findIndex((l) => l.trim().startsWith("- [ ]") && l.includes(matchText));
  if (idx === -1) return false;

  const doneLine = `- [x] ${todayStamp()} ${lines[idx].trim().replace(/^- \[ \]\s*/, "")}`;
  lines.splice(idx, 1);
  let updated = lines.join("\n");

  const doneHeading = /^## Done \(recent\)\s*$/m;
  if (doneHeading.test(updated)) {
    updated = updated.replace(doneHeading, (m) => `${m}\n\n${doneLine}`);
  } else {
    updated = `${updated.replace(/\s*$/, "")}\n\n## Done (recent)\n\n${doneLine}\n`;
  }
  atomicWrite(p, updated);
  return true;
}

/** Append a timestamped bullet to REMINDER.md. Throws if REMINDER.md is missing. */
export function appendReminder(loaded: LoadedProfile, target: SeatTarget, text: string): void {
  const p = requireSeatFile(loaded, target, "REMINDER.md");
  const body = fs.readFileSync(p, "utf8");
  const line = `- ${todayStamp()} ${text}`;
  atomicWrite(p, `${body.replace(/\s*$/, "")}\n\n${line}\n`);
}

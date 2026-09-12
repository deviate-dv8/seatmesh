import fs from "node:fs";
import path from "node:path";
import { buildResolvedPaths, portsForSlot, type LoadedProfile } from "seat-mesh-core";

export interface SeatContextRow {
  seat: string;
  ports: string;
  tasks: number;
  rem: number;
  preview: string;
}

function openChecks(p: string): number {
  if (!fs.existsSync(p)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("- [ ]")) n++;
  }
  return n;
}

function focusPreview(text: string, n = 2): string {
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

export function seatContextRows(loaded: LoadedProfile): SeatContextRow[] {
  const root = buildResolvedPaths(loaded).seatsRoot;
  const formula = loaded.profile.ports?.worker ?? "30{n}0/30{n}1";
  const rows: SeatContextRow[] = [];

  for (let n = 1; n <= 8; n++) {
    const d = path.join(root, `slot-${n}`);
    rows.push({
      seat: `slot-${n}`,
      ports: portsForSlot(formula, n),
      tasks: openChecks(path.join(d, "TASKS.md")),
      rem: openChecks(path.join(d, "REMINDER.md")),
      preview: fs.existsSync(path.join(d, "FOCUS.md"))
        ? focusPreview(fs.readFileSync(path.join(d, "FOCUS.md"), "utf8"))
        : "(no FOCUS.md)",
    });
  }

  for (const col of loaded.profile.layout?.base.columns ?? ["manager", "secretary"]) {
    if (col !== "manager" && col !== "manager-2" && col !== "secretary") continue;
    const seatDir =
      col === "manager"
        ? (loaded.profile.seats.dirs?.manager ?? "manager")
        : col === "manager-2"
          ? (loaded.profile.seats.dirs?.["manager-2"] ?? "manager-2")
          : (loaded.profile.seats.dirs?.secretary ?? "secretary");
    const d = path.join(root, seatDir);
    rows.push({
      seat: seatDir,
      ports: "-",
      tasks: openChecks(path.join(d, "TASKS.md")),
      rem: openChecks(path.join(d, "REMINDER.md")),
      preview: fs.existsSync(path.join(d, "FOCUS.md"))
        ? focusPreview(fs.readFileSync(path.join(d, "FOCUS.md"), "utf8"))
        : "(no FOCUS.md)",
    });
  }

  const miniPat = loaded.profile.seats.dirs?.mini ?? "mini-{n}";
  if (!miniPat.endsWith(".json")) {
    for (let n = 1; n <= loaded.profile.session.miniMax; n++) {
      const miniDir = path.join(root, miniPat.replace("{n}", String(n)));
      rows.push({
        seat: `mini-${n}`,
        ports: "-",
        tasks: openChecks(path.join(miniDir, "TASKS.md")),
        rem: openChecks(path.join(miniDir, "REMINDER.md")),
        preview: fs.existsSync(path.join(miniDir, "FOCUS.md"))
          ? focusPreview(fs.readFileSync(path.join(miniDir, "FOCUS.md"), "utf8"))
          : "(no FOCUS.md)",
      });
    }
  }

  return rows;
}

export function printSeatContexts(loaded: LoadedProfile, json = false): void {
  const root = buildResolvedPaths(loaded).seatsRoot;
  const rows = seatContextRows(loaded);

  if (json) {
    console.log(JSON.stringify({ seatsRoot: root, rows }, null, 2));
    return;
  }

  console.log(`== live seats (${root}) ==`);
  console.log(`${"seat".padEnd(10)} ${"ports".padEnd(12)} ${"tasks".padStart(5)} ${"rem".padStart(4)}  focus-preview`);
  for (const r of rows) {
    console.log(
      `${r.seat.padEnd(10)} ${r.ports.padEnd(12)} ${String(r.tasks).padStart(5)} ${String(r.rem).padStart(4)}  ${r.preview}`,
    );
  }
  console.log("(tasks/rem = open checkbox counts in TASKS.md / REMINDER.md; FOCUS is NOW-only)");
}
import { buildResolvedPaths, portsForSlot, type LoadedProfile } from "@seat-mesh/core";
import { readSeatSnapshot } from "../seats/seat-update.js";

export interface SeatContextRow {
  seat: string;
  ports: string;
  tasks: number;
  rem: number;
  preview: string;
}

function rowFor(loaded: LoadedProfile, seat: string, ports: string, target: { role: string; slot?: string; mini?: string }): SeatContextRow {
  const snap = readSeatSnapshot(loaded, target);
  return {
    seat,
    ports,
    tasks: snap?.tasks.open ?? 0,
    rem: snap?.reminder.open ?? 0,
    preview: snap?.focus.nowPreview ?? "(no FOCUS.md)",
  };
}

export function seatContextRows(loaded: LoadedProfile): SeatContextRow[] {
  buildResolvedPaths(loaded); // preserves the prior existsSync/root resolution side effect (throws on bad profile)
  const formula = loaded.profile.ports?.worker ?? "30{n}0/30{n}1";
  const rows: SeatContextRow[] = [];

  for (let n = 1; n <= 8; n++) {
    rows.push(rowFor(loaded, `slot-${n}`, portsForSlot(formula, n), { role: "worker", slot: String(n) }));
  }

  for (const col of loaded.profile.layout?.base.columns ?? ["manager", "secretary"]) {
    if (col !== "manager" && col !== "manager-2" && col !== "secretary") continue;
    const seatDir =
      col === "manager"
        ? (loaded.profile.seats.dirs?.manager ?? "manager")
        : col === "manager-2"
          ? (loaded.profile.seats.dirs?.["manager-2"] ?? "manager-2")
          : (loaded.profile.seats.dirs?.secretary ?? "secretary");
    rows.push(rowFor(loaded, seatDir, "-", { role: col }));
  }

  const miniPat = loaded.profile.seats.dirs?.mini ?? "mini-{n}";
  if (!miniPat.endsWith(".json")) {
    for (let n = 1; n <= loaded.profile.session.miniMax; n++) {
      rows.push(rowFor(loaded, `mini-${n}`, "-", { role: "mini", mini: String(n) }));
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
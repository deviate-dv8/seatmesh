import fs from "node:fs";
import type { LoadedProfile } from "seat-mesh-core";
import type { PaneRow } from "../lib/resolve-pane.js";
import { seatFile } from "../seats/seat-paths.js";

const MAX = 6000;

export function focusBriefForPane(loaded: LoadedProfile, row: PaneRow): string {
  let file: string | null = null;
  if (row.role === "manager") {
    file = seatFile(loaded, { role: "manager" }, "FOCUS.md");
  } else if (row.role === "secretary") {
    file = seatFile(loaded, { role: "secretary" }, "FOCUS.md");
  } else if (row.slot && /^\d+$/.test(row.slot)) {
    file = seatFile(loaded, { role: "worker", slot: row.slot }, "FOCUS.md");
  } else if (row.mini) {
    file = seatFile(loaded, { role: "manager-mini", mini: row.mini }, "FOCUS.md");
  }
  if (!file) return "(no seat mapping for this pane)";
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return `(empty: ${file})`;
    return text.length > MAX ? `${text.slice(0, MAX)}\n…(truncated)` : text;
  } catch {
    return `(missing: ${file})`;
  }
}

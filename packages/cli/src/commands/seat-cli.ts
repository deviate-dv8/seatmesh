import type { LoadedProfile } from "@seat-mesh/core";
import {
  appendReminder,
  appendTask,
  checkTask,
  parseSeatTarget,
  runAssign,
  setFocusMark,
  setFocusNow,
  type FocusMark,
} from "@seat-mesh/tmux";

const MARKS = new Set<FocusMark>(["OPEN", "BUSY", "BLOCKED"]);

function usage(): never {
  console.error(
    "usage: seat init | seat now <target> <text...> | seat assign <target> <text...> | seat mark <target> <OPEN|BUSY|BLOCKED> | seat task add|check <target> <text...> | seat remind <target> <text...>",
  );
  process.exit(2);
}

export function runSeatCommand(loaded: LoadedProfile, args: string[]): void {
  const [verb, ...rest] = args;
  if (!verb) usage();

  if (verb === "now") {
    const targetRaw = rest[0];
    const text = rest.slice(1).join(" ").trim();
    if (!targetRaw || !text) usage();
    setFocusNow(loaded, parseSeatTarget(targetRaw), text);
    console.log(`OK: seat now ${targetRaw}`);
    return;
  }

  if (verb === "assign") {
    const targetRaw = rest[0];
    const text = rest.slice(1).join(" ").trim();
    if (!targetRaw || !text) usage();
    const r = runAssign(loaded, targetRaw, text);
    console.log(
      `SENT: assign -> ${r.targetLabel} pane=${r.paneId} token=${r.token ?? "-"} via=${r.via ?? "pane-row"}`,
    );
    return;
  }

  if (verb === "mark") {
    const targetRaw = rest[0];
    const markRaw = (rest[1] ?? "").toUpperCase();
    if (!targetRaw || !MARKS.has(markRaw as FocusMark)) usage();
    const target = parseSeatTarget(targetRaw);
    setFocusMark(loaded, target, markRaw as FocusMark);
    console.log(`OK: seat mark ${targetRaw} ${markRaw}`);
    return;
  }

  if (verb === "task") {
    const action = rest[0];
    const targetRaw = rest[1];
    const text = rest.slice(2).join(" ").trim();
    if (!targetRaw || !text) usage();
    const target = parseSeatTarget(targetRaw);
    if (action === "add") {
      appendTask(loaded, target, text);
      console.log(`OK: seat task add ${targetRaw}`);
      return;
    }
    if (action === "check") {
      const ok = checkTask(loaded, target, text);
      if (!ok) {
        console.error(`FAIL: no open TASK matching ${JSON.stringify(text)}`);
        process.exit(1);
      }
      console.log(`OK: seat task check ${targetRaw}`);
      return;
    }
    usage();
  }

  if (verb === "remind") {
    const targetRaw = rest[0];
    const text = rest.slice(1).join(" ").trim();
    if (!targetRaw || !text) usage();
    appendReminder(loaded, parseSeatTarget(targetRaw), text);
    console.log(`OK: seat remind ${targetRaw}`);
    return;
  }

  usage();
}

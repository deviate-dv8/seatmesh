import type { LoadedProfile } from "@seat-mesh/core";
import { resolveTodosConfig } from "@seat-mesh/core";
import {
  appendReminder,
  addSeatTodo,
  checkSeatTodo,
  openTaskLines,
  parseSeatTarget,
  runAssign,
  runWhoami,
  seatFile,
  setFocusMark,
  setFocusNow,
  type FocusMark,
  type SeatTarget,
} from "@seat-mesh/tmux";
import { spawnSync } from "node:child_process";

const MARKS = new Set<FocusMark>(["OPEN", "BUSY", "BLOCKED"]);

function usage(): never {
  console.error(
    "usage:\n" +
      "  seat init | seat now|assign|mark|remind …\n" +
      "  todo give <target> \"…\"     ← GIVE work (FOCUS+TASK+inject+CB≥20m)  preferred\n" +
      "  todo <target> \"…\"          ← same shorthand\n" +
      "  todo list [target] | todo add|check <target> \"…\"\n" +
      "  seat task …                (= todo …)",
  );
  process.exit(2);
}

function looksLikeSeatTarget(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t || t.startsWith("-")) return false;
  if (t === "here" || t === "." || t === "all") return true;
  if (/^(?:slot-)?\d+$/.test(t)) return true;
  if (/^(?:mini|manager-mini)-\d+$/.test(t)) return true;
  if (/^[a-z][a-z0-9-]*$/.test(t)) return true;
  return false;
}

function printGiveResult(r: {
  targetLabel: string;
  paneId: string;
  token?: string;
  via?: string;
}): void {
  console.log(
    `SENT: todo give -> ${r.targetLabel} pane=${r.paneId} token=${r.token ?? "-"} via=${r.via ?? "pane-row"}`,
  );
  console.log(`hint=agent will see FOCUS+TASK; CB≥20m armed; when done: todo check <target> "<match>"`);
}

function tmuxMini(paneId: string | null | undefined): string {
  if (!paneId) return "";
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{@mesh_mini}"], {
    encoding: "utf8",
  });
  return (r.stdout ?? "").trim();
}

function seatTargetHere(loaded: LoadedProfile): SeatTarget {
  const w = runWhoami(loaded);
  const mini = tmuxMini(w.paneId);
  if (w.role === "manager-mini" || mini) {
    return { role: "manager-mini", mini: mini || null };
  }
  if (w.role === "worker") {
    return { role: "worker", slot: w.slot != null ? String(w.slot) : w.slotLabel };
  }
  return { role: w.role };
}

function resolveSeatTarget(loaded: LoadedProfile, raw: string): SeatTarget {
  if (raw === "here" || raw === ".") return seatTargetHere(loaded);
  return parseSeatTarget(raw);
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

  if (verb === "task" || verb === "todo" || verb === "todos") {
    const action = rest[0];
    if (!action) usage();

    // Preferred: todo give <target> "…"  |  todo send|to …
    if (action === "give" || action === "send" || action === "to") {
      const targetRaw = rest[1];
      const text = rest.slice(2).join(" ").trim();
      if (!targetRaw || !text) usage();
      printGiveResult(runAssign(loaded, targetRaw, text));
      return;
    }

    // Shorthand: todo <target> "…"  (no subverb — give work)
    if (
      looksLikeSeatTarget(action) &&
      !["list", "show", "ls", "add", "check", "give", "send", "to"].includes(action)
    ) {
      const text = rest.slice(1).join(" ").trim();
      if (!text) usage();
      printGiveResult(runAssign(loaded, action, text));
      return;
    }

    if (action === "list" || action === "show" || action === "ls") {
      const targetRaw = rest[1] ?? "here";
      const target = resolveSeatTarget(loaded, targetRaw);
      const tasksPath = seatFile(loaded, target, "TASKS.md");
      if (!tasksPath) {
        console.error(`FAIL: no seat dir for ${targetRaw}`);
        process.exit(1);
      }
      const open = openTaskLines(tasksPath);
      const todosCfg = resolveTodosConfig(loaded);
      console.log(`tasks=${tasksPath}`);
      console.log(`todos_report_to=${todosCfg.reportTo}`);
      console.log(`todos_cb=${todosCfg.checkbackDuration} (floor≥20m)`);
      console.log(`todos_open=${open.length}`);
      if (!open.length) console.log("todo=(none open)");
      else for (const t of open) console.log(`todo=${t}`);
      console.log(`give=seatmesh agent todo give <target> "…"  # or: todo <target> "…"`);
      console.log(`mutate=seatmesh agent todo add|check <target> "…"`);
      return;
    }
    const targetRaw = rest[1];
    const text = rest.slice(2).join(" ").trim();
    if (!targetRaw || !text) usage();
    const target = resolveSeatTarget(loaded, targetRaw);
    if (action === "add") {
      const r = addSeatTodo(loaded, target, text, targetRaw);
      console.log(`OK: seat task add ${targetRaw}`);
      console.log(`todo=${r.text}`);
      console.log(`todos_report_to=${r.reportTo}`);
      console.log(
        r.cbArmed
          ? `cb_armed=${r.cbId} duration=${r.cbDuration}`
          : `cb_armed=false reason=${r.cbReason ?? "unknown"}`,
      );
      console.log(`hint=add = file only. To inject work into the pane: todo give ${targetRaw} "…"`);
      return;
    }
    if (action === "check") {
      const r = checkSeatTodo(loaded, target, text, targetRaw);
      if (!r) {
        console.error(`FAIL: no open TASK matching ${JSON.stringify(text)}`);
        process.exit(1);
      }
      console.log(`OK: seat task check ${targetRaw}`);
      console.log(
        r.reported
          ? `reported=${r.reportTo} via=${r.reportVia ?? "?"}`
          : `reported=false reason=${r.reportVia ?? "unknown"}`,
      );
      console.log(`cb_cancelled=${r.cbCancelled}`);
      if (r.remainingOpen > 0) {
        console.log(
          `remaining_open=${r.remainingOpen} bulk=${r.remainingBulkVia ?? "none"}`,
        );
      } else {
        console.log(`remaining_open=0 focus=OPEN`);
      }
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

/**
 * Agent retrieval hub — one place for contexts / chat / todos / acks / cbs / shared.
 * Whoami dumps a short live slice; `agent hub` teaches CRUD + fetches by entity.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  chatFileConfigForLoaded,
  chatRoomConfigForLoaded,
  formatAckOpenLine,
  formatChatTranscript,
  listCheckbacks,
  meshRuntimePaths,
  openAcksForSeat,
  resolveAgentId,
  seatmeshCmd,
  shortAckId,
  tailRoom,
  tailSlotPrompts,
  type AckRow,
  type LoadedProfile,
} from "@seat-mesh/core";
import { openTaskLines } from "../seats/cold-start.js";
import { printSeatContexts } from "../roles/contexts.js";
import { sharedSeatsDir, seatDirFor, seatFile, type SeatTarget } from "../seats/seat-paths.js";
import { runWhoami, type WhoamiResult } from "./whoami.js";
import { hubRetrievalWhoamiLines } from "./hub-lines.js";

const m = (sub: string) => seatmeshCmd(sub);

function tmuxMini(paneId: string | null | undefined): string {
  if (!paneId) return "";
  const r = spawnSync("tmux", ["display-message", "-t", paneId, "-p", "#{@mesh_mini}"], {
    encoding: "utf8",
  });
  return (r.stdout ?? "").trim();
}

function agentIdFor(w: WhoamiResult): string {
  const mini = tmuxMini(w.paneId);
  return resolveAgentId({
    role: w.role,
    slot: w.slot,
    mini: mini || null,
  });
}

function parseAckRow(row: unknown): AckRow | null {
  const r = row as Partial<AckRow>;
  if (!r || typeof r.id !== "string" || typeof r.seat !== "string") return null;
  if (typeof r.ask !== "string") return null;
  return {
    id: r.id,
    at: String(r.at ?? ""),
    seat: r.seat,
    paneId: String(r.paneId ?? ""),
    source: (r.source as AckRow["source"]) || "operator",
    from: r.from,
    ask: r.ask,
    ackedAt: r.ackedAt,
    ackBy: r.ackBy,
    ackNote: r.ackNote,
    reminders: Number(r.reminders ?? 0),
    remindedAt: r.remindedAt,
  };
}

function readJsonlAcks(file: string): AckRow[] {
  if (!fs.existsSync(file)) return [];
  const out: AckRow[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = parseAckRow(JSON.parse(t));
      if (row) out.push(row);
    } catch {
      /* skip */
    }
  }
  return out;
}

function whoamiSeatTarget(w: WhoamiResult): SeatTarget {
  const mini = tmuxMini(w.paneId);
  if (w.role === "manager-mini" || mini) {
    return { role: "manager-mini", mini: mini || null };
  }
  if (w.role === "worker") {
    return { role: "worker", slot: w.slot != null ? String(w.slot) : w.slotLabel };
  }
  return { role: w.role };
}

function printGuide(): void {
  for (const line of hubRetrievalWhoamiLines()) console.log(line);
  console.log("---");
  console.log("usage: seatmesh agent hub [contexts|todos|acks|cbs|chat|room|shared]");
  console.log("alias: seatmesh agent get …");
}

async function printTodos(loaded: LoadedProfile, w: WhoamiResult): Promise<void> {
  const target = whoamiSeatTarget(w);
  const tasksPath = seatFile(loaded, target, "TASKS.md");
  const focusPath = seatFile(loaded, target, "FOCUS.md");
  const seatDir = seatDirFor(loaded, target);
  console.log(`seat=${seatDir ?? "?"}`);
  console.log(`focus=${focusPath ?? "?"}`);
  console.log(`tasks=${tasksPath ?? "?"}`);
  if (!tasksPath || !fs.existsSync(tasksPath)) {
    console.log("todos=missing TASKS.md — run seatmesh agent seat init / session up");
    return;
  }
  const open = openTaskLines(tasksPath);
  console.log(`todos_open=${open.length}`);
  if (!open.length) {
    console.log("todo=(none open)");
  } else {
    for (const t of open) console.log(`todo=${t}`);
  }
  console.log(`mutate=${m('seat task add|check <target> "…"')}`);
}

async function printAcks(loaded: LoadedProfile, w: WhoamiResult): Promise<void> {
  const agentId = agentIdFor(w);
  const open = openAcksForSeat(readJsonlAcks(meshRuntimePaths(loaded).ackJsonl), agentId);
  console.log(`ack_open=${open.length} seat=${agentId}`);
  if (!open.length) {
    console.log("ack=none open");
  } else {
    for (const row of open) console.log(`ack=${formatAckOpenLine(row)}`);
    console.log(
      `mutate=${m(`ack ${shortAckId(open[0]!.id)}`)} | ${m(`ack reply ${shortAckId(open[0]!.id)} "ACK"`)}`,
    );
  }
}

async function printCbs(loaded: LoadedProfile): Promise<void> {
  const base = chatRoomConfigForLoaded(loaded).inboxBase.replace(/\/$/, "");
  const { entries } = await listCheckbacks(base, { all: false });
  console.log(`cbs=${entries.length} (active)`);
  for (const e of entries) {
    console.log(
      `cb=${e.id} status=${e.status} kind=${e.kind} exp=${e.expiresAt ?? "-"} expect=${(e.expect ?? "-").slice(0, 72)}`,
    );
  }
  if (!entries.length) console.log("cb=none active");
  console.log(`mutate=${m('cb start <dur> --expect "…"')} | ${m("cb cancel <id>")}`);
}

async function printChat(loaded: LoadedProfile, w: WhoamiResult, lines = 20): Promise<void> {
  const cfg = chatFileConfigForLoaded(loaded);
  const slot = agentIdFor(w);
  const rows = await tailSlotPrompts(loaded.workspace, cfg, slot, lines);
  console.log(`chat_slot=${slot} lines=${rows.length}`);
  if (!rows.length) {
    console.log("chat=(empty — no CHAT.jsonl yet)");
    return;
  }
  for (const r of rows) {
    console.log(formatChatTranscript(r));
    console.log("---");
  }
}

async function printRoom(loaded: LoadedProfile, slug?: string, n = 20): Promise<void> {
  const cfg = chatRoomConfigForLoaded(loaded);
  const room = slug?.trim() || cfg.globalSlug;
  const lines = await tailRoom(loaded.workspace, cfg, room, n);
  console.log(`room=${room} lines=${lines.length}`);
  for (const line of lines) console.log(line);
  console.log(`mutate=${m(`room say -r ${room} "…"`)}`);
}

function printShared(loaded: LoadedProfile): void {
  const dir = sharedSeatsDir(loaded);
  console.log(`shared=${dir}`);
  if (!fs.existsSync(dir)) {
    console.log("shared=missing — run seatmesh agent seat init");
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  console.log(`shared_mds=${files.length}`);
  for (const f of files) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    console.log(`file=${p} bytes=${st.size}`);
  }
  console.log("hint=edit NOTES.md for slot progress / supervise scratch (HQ+workers+minis)");
}

/**
 * `agent hub` / `agent get` — guide, or fetch one entity.
 * Extra args: hub room supervise · hub chat 40 · hub todos
 */
export async function runAgentHub(loaded: LoadedProfile, args: string[]): Promise<void> {
  const [entityRaw, ...rest] = args;
  const entity = (entityRaw ?? "").trim().toLowerCase();

  if (!entity || entity === "help" || entity === "--help" || entity === "-h") {
    printGuide();
    const w = runWhoami(loaded);
    console.log("--- live (this seat) ---");
    console.log(`you_are=${w.role} pane=${w.paneId ?? "?"}`);
    await printAcks(loaded, w);
    try {
      await printCbs(loaded);
    } catch (e) {
      console.log(`cbs=unavailable (${(e as Error).message})`);
    }
    await printTodos(loaded, w);
    printShared(loaded);
    return;
  }

  const w = runWhoami(loaded);

  if (entity === "contexts" || entity === "seats") {
    printSeatContexts(loaded, rest.includes("--json"));
    return;
  }
  if (entity === "todos" || entity === "tasks" || entity === "task") {
    await printTodos(loaded, w);
    return;
  }
  if (entity === "acks" || entity === "ack") {
    await printAcks(loaded, w);
    return;
  }
  if (entity === "cbs" || entity === "cb" || entity === "checkback") {
    await printCbs(loaded);
    return;
  }
  if (entity === "chat" || entity === "chathistory" || entity === "history") {
    const n = Number.parseInt(rest[0] ?? "20", 10);
    await printChat(loaded, w, Number.isFinite(n) ? n : 20);
    return;
  }
  if (entity === "room" || entity === "rooms") {
    const slug = rest[0]?.startsWith("-") ? undefined : rest[0];
    const nFlag = rest.find((a) => a === "-n");
    const nIdx = nFlag ? rest.indexOf(nFlag) : -1;
    const n = nIdx >= 0 ? Number.parseInt(rest[nIdx + 1] ?? "20", 10) : 20;
    await printRoom(loaded, slug, Number.isFinite(n) ? n : 20);
    return;
  }
  if (entity === "shared" || entity === "notes") {
    printShared(loaded);
    return;
  }
  if (entity === "sessions" || entity === "meshes" || entity === "remotes") {
    console.log(`retrieve=${m("remote")} | ${m("sessions")} [--json]`);
    console.log(`send=${m('remote <alias> <seat> "…"')} | ${m('peer @alias:seat "…"')}`);
    console.log("hint: seatmesh agent remote  # list; then remote pia secretary \"…\"");
    return;
  }

  console.error(
    `unknown hub entity: ${entityRaw}\nwant: contexts|todos|acks|cbs|chat|room|shared|sessions (or bare hub)`,
  );
  process.exit(2);
}

import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  type LoadedProfile,
  type RoomMessageKind,
  chatRoomConfigForLoaded,
  createRoom,
  markRoomRead,
  sayInRoom,
  tailRoom,
  listRooms,
  resolveAgentId,
  resolveRoomSlug,
  ensureGlobalRoom,
  canBroadcastToGlobal,
  isGlobalSlug,
  formatRoomCommsCheckback,
  unseenSummaryForAgent,
} from "seat-mesh-core";
import {
  fanOutRoomMessage,
  runRoomAccept,
  runRoomCall,
  runRoomCallsList,
  runRoomDecline,
  runWhoami,
} from "seat-mesh-tmux";

function tmuxOpt(pane: string, key: string): string {
  const r = spawnSync("tmux", ["display-message", "-t", pane, "-p", key], { encoding: "utf8" });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").trim();
}

function resolveFrom(loaded: LoadedProfile, explicit?: string): string {
  if (explicit) return explicit;
  const w = runWhoami(loaded);
  const mini = tmuxOpt(w.paneId ?? "", "#{@mesh_mini}");
  return resolveAgentId({ role: w.role, slot: w.slot, mini: mini || null });
}

function resolvePane(explicit?: string): string | undefined {
  return explicit ?? process.env.TMUX_PANE ?? undefined;
}

function paneContext(loaded: LoadedProfile) {
  const w = runWhoami(loaded);
  const mini = tmuxOpt(w.paneId ?? "", "#{@mesh_mini}");
  return { w, mini };
}

async function runSay(
  loaded: LoadedProfile,
  roomSlug: string,
  body: string,
  opts: {
    kind?: RoomMessageKind;
    checkback?: boolean;
    fanout?: boolean;
    from?: string;
    pane?: string;
  },
): Promise<void> {
  const cfg = chatRoomConfigForLoaded(loaded);
  const slug = resolveRoomSlug(cfg, roomSlug);
  const { w, mini } = paneContext(loaded);
  const ownerPane = resolvePane(opts.pane);
  const result = await sayInRoom(loaded.workspace, cfg, slug, resolveFrom(loaded, opts.from), body, {
    kind: opts.kind,
    armCheckback: opts.checkback !== false,
    ownerPane,
    senderPane: ownerPane,
    ownerMini: mini || null,
    ownerSlot: w.slot,
  });
  console.log(`ok room=${slug} id=${result.message.id} kind=${result.message.kind}`);
  const shouldFanOut = opts.fanout !== false;
  if (shouldFanOut) {
    const fan = fanOutRoomMessage(loaded, {
      slug,
      from: result.message.from,
      kind: result.message.kind,
      body: result.message.body,
      senderPane: ownerPane,
    });
    console.log(
      `fan-out: sent=${fan.sent} enqueued=${fan.enqueued} skipped=${fan.skipped}${fan.failed ? ` failed=${fan.failed}` : ""}`,
    );
  }
  if (result.checkback?.skipped) {
    console.log(`checkback: skipped (${result.checkback.reason ?? "?"})`);
  } else if (result.checkback && !result.checkback.ok) {
    console.log(`checkback: failed (${result.checkback.reason ?? "?"})`);
  } else if (result.checkback?.ok) {
    console.log("checkback: armed");
    const expect = `chat-room:${slug} peer update (${result.message.kind})`;
    const hint = formatRoomCommsCheckback(expect, {
      role: w.role,
      slot: w.slot,
      mini: mini || null,
      workerCount: loaded.profile.session.workerCount,
      miniMax: loaded.profile.session.miniMax,
    });
    console.log("--- on Check: fire, run ---");
    for (const line of hint.split("\n").slice(1)) {
      console.log(line);
    }
  }
}

export function buildRoomCommands(getLoaded: () => LoadedProfile): Command {
  const room = new Command("room").description(
    "ChatRoom ledger — default room is global (all tmux agents)",
  );

  room
    .command("list")
    .description("List chat room slugs (global always present)")
    .action(() => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      ensureGlobalRoom(loaded.workspace, cfg);
      const slugs = new Set(listRooms(loaded.workspace, cfg));
      slugs.add(cfg.globalSlug);
      for (const slug of [...slugs].sort()) {
        const tag = isGlobalSlug(cfg, slug) ? "\t(global — all agents)" : "";
        console.log(`${slug}${tag}`);
      }
    });

  room
    .command("create")
    .alias("open")
    .description("Open a named chat contract (not global)")
    .argument("<slug>", "room slug (cannot be global slug)")
    .option("--scope <text>", "contract scope")
    .option("--lead <id>", "lead agent id (e.g. mini-1)")
    .option("--supervisor <id>", "supervisor agent id (often secretary)")
    .option("--members <ids>", "comma-separated member ids")
    .option("--from <id>", "creator agent id (default: tmux pane)")
    .action((slug, opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      if (isGlobalSlug(cfg, slug)) {
        console.error(`slug "${slug}" is reserved for the global room`);
        process.exit(2);
      }
      const profile = createRoom({
        workspace: loaded.workspace,
        cfg,
        slug,
        createdBy: resolveFrom(loaded, opts.from),
        kind: "contract",
        scope: opts.scope,
        lead: opts.lead,
        supervisor: opts.supervisor,
        members: opts.members?.split(",").map((s: string) => s.trim()),
      });
      console.log(`room=${profile.slug} path=${loaded.workspace}/${cfg.root}/${slug}`);
      console.log(`createdBy=${profile.createdBy}`);
    });

  room
    .command("say")
    .description("Append a line (default room: global)")
    .argument("<message...>", "ledger line — omit slug to use global")
    .option("-r, --room <slug>", "target room (default: global)")
    .option("--kind <kind>", "claim|done|blocked|fyi|broadcast|status|msg")
    .option("--no-checkback", "skip inbox checkback arm")
    .option("--no-fanout", "ledger only — do not PEER-inject [mesh-inbox-room] to peers")
    .option("--from <id>", "sender agent id")
    .option("--pane <id>", "tmux pane for checkback target")
    .action(async (messageParts: string[], opts) => {
      const loaded = getLoaded();
      const body = messageParts.join(" ").trim();
      if (!body) {
        console.error("room say: message required");
        process.exit(2);
      }
      const cfg = chatRoomConfigForLoaded(loaded);
      const slug = resolveRoomSlug(cfg, opts.room);
      await runSay(loaded, slug, body, opts);
    });

  room
    .command("broadcast")
    .description("Manager/secretary: fan-out line to global (all agents)")
    .argument("<message...>", "BROADCAST line to every agent")
    .option("--no-checkback", "skip inbox checkback arm")
    .option("--no-fanout", "ledger only — do not PEER-inject peers")
    .option("--from <id>", "sender agent id")
    .option("--pane <id>", "tmux pane for checkback target")
    .action(async (messageParts: string[], opts) => {
      const loaded = getLoaded();
      const { w } = paneContext(loaded);
      if (!canBroadcastToGlobal(w.role)) {
        console.error(`room broadcast: manager/secretary only (you_are=${w.role})`);
        process.exit(2);
      }
      const body = messageParts.join(" ").trim();
      if (!body) {
        console.error("room broadcast: message required");
        process.exit(2);
      }
      const cfg = chatRoomConfigForLoaded(loaded);
      // Broadcast is fan-out FYI — do not arm sender checkback (was spamming Check: on
      // manager and agents misread it as supervise targeting slots 1-8).
      await runSay(loaded, cfg.globalSlug, body, {
        ...opts,
        kind: "broadcast",
        checkback: false,
      });
    });

  room
    .command("call")
    .description("Worker: invite another worker to open a peer room (they accept|decline)")
    .argument("<target>", "slot-N or bare N")
    .argument("<topic...>", "discussion topic / scope")
    .action((_target, topicParts: string[]) => {
      const loaded = getLoaded();
      const topic = topicParts.join(" ").trim();
      try {
        runRoomCall(loaded, _target, topic);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });

  room
    .command("accept")
    .description("Worker: accept an incoming room call (creates peer room + CONNECTED line)")
    .argument("<call-id>", "short call id from CALL inject")
    .action(async (callId: string) => {
      const loaded = getLoaded();
      try {
        await runRoomAccept(loaded, callId);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });

  room
    .command("decline")
    .description("Worker: decline an incoming room call")
    .argument("<call-id>", "short call id")
    .option("--reason <text>", "optional decline reason")
    .action((callId: string, opts: { reason?: string }) => {
      const loaded = getLoaded();
      try {
        runRoomDecline(loaded, callId, opts.reason);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });

  room
    .command("calls")
    .description("List pending room calls for this agent")
    .action(() => {
      const loaded = getLoaded();
      try {
        runRoomCallsList(loaded);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });

  room
    .command("read")
    .description("Mark room messages read for this agent (clears unseen count)")
    .option("-r, --room <slug>", "room slug (required for contract rooms)")
    .action((opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      const slug = resolveRoomSlug(cfg, opts.room);
      const agentId = resolveFrom(loaded);
      const { marked } = markRoomRead(loaded.workspace, cfg, slug, agentId);
      console.log(`ok room=${slug} marked=${marked} unseen=0`);
    });

  room
    .command("tail")
    .description("Show last N lines (default room: global); auto-marks read")
    .option("-r, --room <slug>", "room slug (default: global)")
    .option("-n, --lines <n>", "line count", "50")
    .option("--no-read", "do not mark messages read")
    .action(async (opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      const slug = resolveRoomSlug(cfg, opts.room);
      const agentId = resolveFrom(loaded);
      const unseenBefore = unseenSummaryForAgent(loaded.workspace, cfg, slug, agentId);
      if (unseenBefore > 0) {
        console.log(`unseen: ${unseenBefore}`);
      }
      const n = Number.parseInt(String(opts.lines), 10) || 50;
      const lines = await tailRoom(loaded.workspace, cfg, slug, n);
      for (const row of lines) {
        console.log(`${row.ts}\t${row.from}\t${row.kind}\t${row.body}`);
      }
      if (opts.read !== false) {
        markRoomRead(loaded.workspace, cfg, slug, agentId);
      }
    });

  return room;
}

export function buildContractCommands(getLoaded: () => LoadedProfile): Command {
  const contract = new Command("contract").description("Alias: open a parallel chat contract");

  contract
    .command("create")
    .alias("open")
    .description("Same as room create (not global)")
    .argument("<slug>", "room slug")
    .option("--scope <text>", "contract scope")
    .option("--lead <id>", "lead agent id")
    .option("--supervisor <id>", "supervisor agent id")
    .option("--members <ids>", "comma-separated member ids")
    .option("--from <id>", "creator agent id")
    .action((slug, opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      if (isGlobalSlug(cfg, slug)) {
        console.error(`slug "${slug}" is reserved for the global room`);
        process.exit(2);
      }
      const profile = createRoom({
        workspace: loaded.workspace,
        cfg,
        slug,
        createdBy: resolveFrom(loaded, opts.from),
        kind: "contract",
        scope: opts.scope,
        lead: opts.lead,
        supervisor: opts.supervisor,
        members: opts.members?.split(",").map((s: string) => s.trim()),
      });
      console.log(`room=${profile.slug} path=${loaded.workspace}/${cfg.root}/${slug}`);
      console.log(`createdBy=${profile.createdBy}`);
    });

  return contract;
}

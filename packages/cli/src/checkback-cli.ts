import { Command } from "commander";
import {
  type LoadedProfile,
  type CheckbackEntry,
  armCheckback,
  ackCheckback,
  cancelAllCheckbacks,
  cancelCheckback,
  chatRoomConfigForLoaded,
  expiresAtUtcFromDuration,
  listCheckbacks,
  parseDurationToSeconds,
  resetCheckback,
} from "@seat-mesh/core";
import {
  ensureMeshInbox,
  meshInboxPort,
  resolvePaneTarget,
  runWhoami,
} from "@seat-mesh/tmux";

function requireMeshInbox(loaded: LoadedProfile): void {
  if (ensureMeshInbox(loaded, { quiet: true })) return;
  const port = meshInboxPort(loaded);
  console.error(
    `FAIL: mesh inbox down on :${port} (auto-start failed) — run: ./sm.sh inbox restart`,
  );
  process.exit(1);
}

function parseAckAnswer(raw: string): boolean | null {
  const a = raw.trim().toLowerCase();
  if (a === "y" || a === "yes" || a === "true" || a === "1") return true;
  if (a === "n" || a === "no" || a === "false" || a === "0") return false;
  return null;
}

function resolveTargetPane(
  loaded: LoadedProfile,
  opts: { here?: boolean; slot?: string; mini?: string; pane?: string },
): string {
  if (opts.pane) {
    const hit = resolvePaneTarget(opts.pane, loaded);
    if ("error" in hit) throw new Error(hit.error);
    return hit.paneId;
  }
  if (opts.mini) {
    const hit = resolvePaneTarget(`mini-${opts.mini}`, loaded);
    if ("error" in hit) throw new Error(hit.error);
    return hit.paneId;
  }
  if (opts.slot) {
    const hit = resolvePaneTarget(opts.slot, loaded);
    if ("error" in hit) throw new Error(hit.error);
    return hit.paneId;
  }
  if (opts.here || !opts.pane) {
    const hit = resolvePaneTarget("here", loaded);
    if ("error" in hit) throw new Error(hit.error);
    return hit.paneId;
  }
  throw new Error("checkback start: no target pane (--here|--slot N|--mini N|--pane %id)");
}

function printEntry(e: CheckbackEntry): void {
  const left = e.expiresAt ? `exp=${e.expiresAt}` : "exp=n/a";
  const renew = e.renewSec ? `renew=${e.renewSec}s` : "renew=-";
  console.log(
    `${e.id}\t${e.status}\t${e.kind}\t${left}\t${renew}\t${e.ownerPane ?? "-"}\t${(e.expect ?? "-").slice(0, 80)}`,
  );
}

export function buildCheckbackCommands(getLoaded: () => LoadedProfile): Command {
  const checkback = new Command("checkback")
    .alias("patience")
    .description("Mesh inbox poll-later (daemon injects Check: on expiry)");

  checkback
    .command("start <duration>")
    .description(
      'Arm checkback — harness shape: start 5m --expect "topic" [--renew 3m] [--here|--slot N|--mini N]',
    )
    .option("--expect <text>", "what to verify when timer fires")
    .option("--renew <dur>", "re-arm interval after fire", "3m")
    .option("--here", "target current tmux pane")
    .option("--slot <n>", "target worker slot pane")
    .option("--mini <n>", "target mini pane")
    .option("--pane <id>", "target tmux pane id")
    .option("--kind <kind>", "entry kind", "checkback")
    .allowExcessArguments(true)
    .action(async (duration: string, opts, cmd) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const cfg = chatRoomConfigForLoaded(loaded);

      if (parseDurationToSeconds(duration) == null) {
        console.error(`checkback start: bad duration '${duration}' (use 30s, 5m, 1h)`);
        process.exit(2);
      }

      const trailing = (cmd.args as string[]).slice(1).filter(Boolean);
      let expect = (opts.expect as string | undefined)?.trim() ?? "";
      if (!expect && trailing.length) {
        expect = trailing.join(" ").trim();
      }
      if (!expect) {
        console.error(
          'usage: checkback start <duration> --expect "topic" [--renew 3m] [--here|--slot N|--mini N]',
        );
        process.exit(2);
      }

      let ownerPane: string;
      try {
        ownerPane = resolveTargetPane(loaded, {
          here: opts.here as boolean | undefined,
          slot: opts.slot as string | undefined,
          mini: opts.mini as string | undefined,
          pane: opts.pane as string | undefined,
        });
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }

      const res = await armCheckback({
        inboxBase: cfg.inboxBase,
        ownerPane,
        expect,
        duration,
        renew: opts.renew as string,
        kind: opts.kind as string,
        senderPane: runWhoami(loaded).paneId ?? ownerPane,
      });
      if (!res.ok) {
        console.error(`checkback start: FAIL ${res.reason ?? "?"}`);
        process.exit(1);
      }
      const entry = (res.response as { entry?: CheckbackEntry } | undefined)?.entry;
      if (!entry) {
        console.error("checkback start: FAIL no entry returned");
        process.exit(1);
      }
      console.log(`ok id=${entry.id} expiresAt=${entry.expiresAt ?? "-"} expect=${expect}`);
    });

  checkback
    .command("list")
    .alias("ls")
    .description("List checkback entries (active by default)")
    .option("--all", "include cancelled entries")
    .option("--json", "raw JSON")
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const cfg = chatRoomConfigForLoaded(loaded);
      const out = await listCheckbacks(cfg.inboxBase, { all: opts.all });
      if (opts.json) {
        console.log(JSON.stringify(out, null, 2));
        return;
      }
      if (!out.entries.length) {
        console.log("no checkbacks");
        return;
      }
      for (const e of out.entries) printEntry(e);
    });

  checkback
    .command("cancel")
    .description("Cancel a checkback by id (id prefix ok)")
    .argument("<id>", "checkback id or prefix")
    .action(async (id: string) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const cfg = chatRoomConfigForLoaded(loaded);
      const res = await cancelCheckback(cfg.inboxBase, id);
      console.log(`ok cancelled=${res.cancelled}`);
    });

  checkback
    .command("cancel-all")
    .description("Cancel every active checkback (mesh inbox poll-later)")
    .action(async () => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const cfg = chatRoomConfigForLoaded(loaded);
      const res = await cancelAllCheckbacks(cfg.inboxBase);
      console.log(`ok cancelled=${res.cancelled}`);
    });

  checkback
    .command("reset")
    .description("Reset checkback expiry (harness: reset <id> <duration>)")
    .argument("<id>", "checkback id or prefix")
    .argument("<duration>", "new duration from now (30s, 5m, 1h)")
    .action(async (id: string, duration: string) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const cfg = chatRoomConfigForLoaded(loaded);
      const expiresAt = expiresAtUtcFromDuration(duration);
      if (!expiresAt) {
        console.error(`checkback reset: bad duration '${duration}'`);
        process.exit(2);
      }
      const res = await resetCheckback(cfg.inboxBase, id, expiresAt);
      if (!res.ok || !res.entry) {
        console.error(`checkback reset: FAIL ${res.error ?? "?"}`);
        process.exit(1);
      }
      console.log(`ok id=${res.entry.id} expiresAt=${res.entry.expiresAt ?? "-"}`);
    });

  checkback
    .command("ack")
    .description("Ack CHECKBACK? intercept — yes cancels (matched), no ignores")
    .argument("<id>", "checkback id or prefix")
    .argument("<answer>", "yes|no")
    .action(async (id: string, answer: string) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const cfg = chatRoomConfigForLoaded(loaded);
      const yes = parseAckAnswer(answer);
      if (yes == null) {
        console.error("checkback ack: want yes|no");
        process.exit(2);
      }
      const res = await ackCheckback(cfg.inboxBase, id, yes);
      if (!res.ok) {
        console.error(`checkback ack: FAIL ${res.error ?? "?"}`);
        process.exit(1);
      }
      console.log(`ok action=${res.action ?? "?"} id=${res.id ?? id}`);
    });

  return checkback;
}

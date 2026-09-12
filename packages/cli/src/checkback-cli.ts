import { Command } from "commander";
import {
  type LoadedProfile,
  type CheckbackEntry,
  armCheckback,
  cancelAllCheckbacks,
  cancelCheckback,
  chatRoomConfigForLoaded,
  listCheckbacks,
} from "seat-mesh-core";
import { ensureMeshInbox, runWhoami } from "seat-mesh-tmux";

function resolvePane(loaded: LoadedProfile, explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  return runWhoami(loaded).paneId ?? undefined;
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
    .description("Mesh inbox :3100 /patience poll-later entries (daemon injects on expiry)");

  checkback
    .command("start")
    .description("Arm a checkback — daemon writes 'Check: <expect>' into a tmux pane on expiry")
    .requiredOption("--expect <text>", "what to be checked back on")
    .option("--duration <dur>", "how long until fire (default: profile 5m)", "5m")
    .option("--renew <dur>", "re-arm with this interval after firing (default: 3m)", "3m")
    .option("--pane <id>", "target tmux pane id (default: current pane)")
    .option("--kind <kind>", "entry kind (default: checkback)", "checkback")
    .option("--from <id>", "sender agent id")
    .action(
      async (opts: {
        expect: string;
        duration: string;
        renew: string;
        pane?: string;
        kind: string;
        from?: string;
      }) => {
        const loaded = getLoaded();
        const cfg = chatRoomConfigForLoaded(loaded);
        ensureMeshInbox(loaded, { quiet: true });
        const ownerPane = resolvePane(loaded, opts.pane);
        if (!ownerPane) {
          console.error("checkback start: no target pane");
          process.exit(2);
        }
        const res = await armCheckback({
          inboxBase: cfg.inboxBase,
          ownerPane,
          expect: opts.expect,
          duration: opts.duration,
          renew: opts.renew,
          kind: opts.kind,
          senderPane: ownerPane,
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
        console.log(`ok id=${entry.id} expiresAt=${entry.expiresAt ?? "-"} expect=${opts.expect}`);
      },
    );

  checkback
    .command("list")
    .alias("ls")
    .description("List checkback entries (active by default)")
    .option("--all", "include cancelled entries")
    .option("--json", "raw JSON")
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      ensureMeshInbox(loaded, { quiet: true });
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
      const cfg = chatRoomConfigForLoaded(loaded);
      ensureMeshInbox(loaded, { quiet: true });
      const res = await cancelCheckback(cfg.inboxBase, id);
      console.log(`ok cancelled=${res.cancelled}`);
    });

  checkback
    .command("cancel-all")
    .description("Cancel every active checkback (mesh inbox poll-later)")
    .action(async () => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      ensureMeshInbox(loaded, { quiet: true });
      const res = await cancelAllCheckbacks(cfg.inboxBase);
      console.log(`ok cancelled=${res.cancelled}`);
    });

  return checkback;
}
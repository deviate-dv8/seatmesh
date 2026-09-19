import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  type LoadedProfile,
  chatFileConfigForLoaded,
  appendSlotPrompt,
  tailSlotPrompts,
  querySlotPrompts,
  recordPromptFromPane,
  recordAllPanes,
  resolveAgentId,
  resolveSlotKeyFromPane,
  formatChatTranscript,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { runWhoami, capturePaneSnapshot, listSessionPanes } from "@seat-mesh/tmux";

function tmuxOpt(pane: string, key: string): string {
  const r = spawnSync("tmux", ["display-message", "-t", pane, "-p", key], { encoding: "utf8" });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").trim();
}

function resolveSlotFromWhere(loaded: LoadedProfile, explicit?: string): string {
  if (explicit) return explicit;
  const w = runWhoami(loaded);
  const mini = tmuxOpt(w.paneId ?? "", "#{@mesh_mini}");
  return resolveAgentId({ role: w.role, slot: w.slot, mini: mini || null });
}

function printRecords(rows: Awaited<ReturnType<typeof tailSlotPrompts>>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    console.log(formatChatTranscript(r));
    console.log("---");
  }
}

export function buildChatCommands(getLoaded: () => LoadedProfile): Command {
  const chat = new Command("chat").description(
    "Per-slot prompt log (CHAT.jsonl) — session, model, human prompt, agent response",
  );

  chat
    .command("tail")
    .description("Last N records for a slot (default: current pane slot)")
    .option("--slot <key>", "worker-1, mini-3, manager, ...")
    .option("--lines <n>", "line count", "30")
    .option("--json", "JSON output")
    .action(async (opts: { slot?: string; lines: string; json?: boolean }) => {
      const loaded = getLoaded();
      const cfg = chatFileConfigForLoaded(loaded);
      const slot = resolveSlotFromWhere(loaded, opts.slot);
      const rows = await tailSlotPrompts(loaded.workspace, cfg, slot, Number.parseInt(opts.lines, 10));
      printRecords(rows, Boolean(opts.json));
    });

  chat
    .command("query")
    .description("Filter records across slots")
    .option("--slot <key>")
    .option("--session <id>")
    .option("--provider <id>")
    .option("--agent <id>", "speaker id e.g. mini-1-oc, slot-3-kiro")
    .option("--model <name>")
    .option("--since <iso>")
    .option("--limit <n>", "max rows", "100")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        slot?: string;
        session?: string;
        provider?: string;
        agent?: string;
        model?: string;
        since?: string;
        limit: string;
        json?: boolean;
      }) => {
        const loaded = getLoaded();
        const cfg = chatFileConfigForLoaded(loaded);
        const rows = await querySlotPrompts(loaded.workspace, cfg, {
          slot: opts.slot,
          sessionId: opts.session,
          providerId: opts.provider,
          agent: opts.agent,
          model: opts.model,
          since: opts.since,
          limit: Number.parseInt(opts.limit, 10),
        });
        printRecords(rows, Boolean(opts.json));
      },
    );

  chat
    .command("append")
    .description("Append one turn explicitly (inject hook or manual)")
    .requiredOption("--human <text>", "human prompt")
    .option("--response <text>", "agent response")
    .option("--slot <key>", "default: current pane")
    .option("--session <id>")
    .option("--model <name>")
    .option("--provider <id>", "default: detected provider or unknown")
    .option("--pane <id>", "tmux pane id for metadata")
    .action(
      async (opts: {
        human: string;
        response?: string;
        slot?: string;
        session?: string;
        model?: string;
        provider?: string;
        pane?: string;
      }) => {
        const loaded = getLoaded();
        const cfg = chatFileConfigForLoaded(loaded);
        const slot = resolveSlotFromWhere(loaded, opts.slot);
        const reg = createRegistryForProfile(loaded.profile);
        let providerId = opts.provider ?? "unknown";
        if (!opts.provider && opts.pane) {
          const snap = capturePaneSnapshot(opts.pane);
          if (snap) providerId = reg.detect(snap)?.id ?? providerId;
        } else if (!opts.provider) {
          const w = runWhoami(loaded);
          if (w.paneId) {
            const snap = capturePaneSnapshot(w.paneId);
            if (snap) providerId = reg.detect(snap)?.id ?? providerId;
          }
        }
        const row = await appendSlotPrompt(loaded.workspace, cfg, {
          slot,
          paneId: opts.pane,
          providerId,
          sessionId: opts.session,
          model: opts.model,
          humanPrompt: opts.human,
          agentResponse: opts.response,
        });
        console.log(
          `ok id=${row.id} slot=${row.slot} agent=${row.agent} humanKind=${row.humanKind} turnHash=${row.turnHash}`,
        );
      },
    );

  chat
    .command("put")
    .description("Positional upsert — same as `chat append --human` (dedup by turnHash)")
    .argument("<slot>", "worker-1, mini-3, manager, ...")
    .argument("<human...>", "human prompt text")
    .option("--response <text>", "agent response")
    .option("--session <id>")
    .option("--model <name>")
    .option("--provider <id>", "default: unknown")
    .action(
      async (
        slot: string,
        humanParts: string[],
        opts: { response?: string; session?: string; model?: string; provider?: string },
      ) => {
        const loaded = getLoaded();
        const cfg = chatFileConfigForLoaded(loaded);
        const human = humanParts.join(" ").trim();
        if (!human) {
          console.error("chat put: human prompt required");
          process.exit(2);
        }
        const row = await appendSlotPrompt(loaded.workspace, cfg, {
          slot,
          providerId: opts.provider ?? "unknown",
          sessionId: opts.session,
          model: opts.model,
          humanPrompt: human,
          agentResponse: opts.response,
        });
        console.log(
          `ok id=${row.id} slot=${row.slot} agent=${row.agent} turnHash=${row.turnHash}`,
        );
      },
    );

  chat
    .command("get")
    .description("Look up one chat record by id or turnHash (full or 8-char prefix)")
    .argument("<id>", "record id or turnHash, full or 8-char prefix")
    .option("--slot <key>", "search only this slot (default: all slots)")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { slot?: string; json?: boolean }) => {
      const loaded = getLoaded();
      const cfg = chatFileConfigForLoaded(loaded);
      const rows = await querySlotPrompts(loaded.workspace, cfg, {
        slot: opts.slot,
        limit: Number.MAX_SAFE_INTEGER,
      });
      const row = rows.find(
        (r) =>
          r.id === id ||
          r.id.startsWith(id) ||
          r.turnHash === id ||
          Boolean(r.turnHash?.startsWith(id)),
      );
      if (!row) {
        console.error(`chat get: no record ${id}${opts.slot ? ` in slot=${opts.slot}` : ""}`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(row, null, 2));
      } else {
        console.log(formatChatTranscript(row));
      }
    });

  chat
    .command("record")
    .description("Scrape pane(s) via AgentProvider and append new turns")
    .option("--pane <id>", "single tmux pane")
    .option("--all", "every pane in session")
    .option("--session <name>", "tmux session name")
    .action(async (opts: { pane?: string; all?: boolean; session?: string }) => {
      const loaded = getLoaded();
      const cfg = chatFileConfigForLoaded(loaded);
      const reg = createRegistryForProfile(loaded.profile);

      if (opts.all) {
        const session = opts.session ?? loaded.sessionName;
        const panes = listSessionPanes(session);
        const snaps = panes
          .map((id) => capturePaneSnapshot(id))
          .filter((s): s is NonNullable<typeof s> => s != null);
        const results = await recordAllPanes(loaded.workspace, cfg, reg, snaps);
        let recorded = 0;
        for (const r of results) {
          if (r.recorded) recorded++;
        }
        console.log(`ok scanned=${snaps.length} recorded=${recorded}`);
        return;
      }

      const paneId = opts.pane ?? process.env.TMUX_PANE;
      if (!paneId) {
        console.error("record: need --pane, --all, or TMUX_PANE");
        process.exit(2);
      }
      const snap = capturePaneSnapshot(paneId);
      if (!snap) {
        console.error(`record: could not capture ${paneId}`);
        process.exit(1);
      }
      const provider = reg.detect(snap);
      if (!provider || provider.id === "empty") {
        console.error("record: no agent provider on pane");
        process.exit(1);
      }
      const detection = provider.detect(snap);
      if (!detection) {
        console.error("record: provider detect failed");
        process.exit(1);
      }
      const result = await recordPromptFromPane(
        loaded.workspace,
        cfg,
        provider,
        snap,
        detection,
      );
      if (!result.recorded) {
        console.log(`skip: ${result.reason ?? "not recorded"}`);
        return;
      }
      console.log(
        `ok id=${result.record?.id} slot=${result.record?.slot} agent=${result.record?.agent} humanKind=${result.record?.humanKind} session=${result.record?.sessionId ?? "-"}`,
      );
    });

  return chat;
}

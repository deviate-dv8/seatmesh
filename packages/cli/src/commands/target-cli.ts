import { Command } from "commander";
import {
  type LoadedProfile,
  addTargetSync,
  listTargetsSync,
  targetCancel,
  targetDone,
  targetRemind,
  targetTriage,
} from "@seat-mesh/core";
import { ensureMeshInbox, meshInboxPort } from "@seat-mesh/tmux";

function requireMeshInbox(loaded: LoadedProfile): string {
  if (!ensureMeshInbox(loaded, { quiet: true })) {
    const port = meshInboxPort(loaded);
    console.error(
      `FAIL: mesh inbox down on :${port} (auto-start failed) — run: seatmesh inbox restart`,
    );
    process.exit(1);
  }
  return `http://127.0.0.1:${meshInboxPort(loaded)}`;
}

function parseTriageTo(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildTargetCommands(getLoaded: () => LoadedProfile): Command {
  const target = new Command("target")
    .alias("targets")
    .description(
      "Operator goals + EOD deadlines. Scope = whole goal (leads triage/break down); slice = child deadline.",
    );

  target
    .command("add <goal...>")
    .description("Add a scope (default) or slice under a scope")
    .option("--deadline <when>", "eod | ISO | duration (6h)", "eod")
    .option("--triage <seats>", "comma seats when due (default manager,secretary)")
    .option("--scope", "explicit whole-goal scope (default when no --under)")
    .option("--under <scopeId>", "add a workable slice under this scope")
    .action(
      async (
        goalParts: string[],
        opts: { deadline?: string; triage?: string; scope?: boolean; under?: string },
      ) => {
        const loaded = getLoaded();
        const base = requireMeshInbox(loaded);
        const goal = goalParts.join(" ").trim();
        const parentId = opts.under?.trim();
        const kind = parentId ? "slice" : "scope";
        const r = addTargetSync({
          inboxBase: base,
          goal,
          deadline: opts.deadline,
          triageTo: parseTriageTo(opts.triage),
          kind,
          parentId,
        });
        if (!r.ok || !r.target) {
          console.error(`FAIL: ${r.error ?? "add target"}`);
          process.exit(1);
        }
        const t = r.target;
        console.log(
          `ok id=${t.id} kind=${t.kind ?? "-"} parent=${t.parentId?.slice(0, 8) ?? "-"} deadline=${t.deadlineAt}`,
        );
        console.log(`goal: ${t.goal}`);
        if (t.kind === "scope") {
          console.log(`break down: seatmesh target add "<slice>" --under ${t.id.slice(0, 8)} --deadline 6h`);
          console.log(`triage leads: seatmesh target triage ${t.id.slice(0, 8)}`);
        }
        console.log(`ui: http://127.0.0.1:${meshInboxPort(loaded)}/ui/`);
        console.log(`done: seatmesh target done ${t.id.slice(0, 8)}`);
      },
    );

  target
    .command("list")
    .description("List active targets (use --all for done/cancelled)")
    .option("--all", "include done/cancelled")
    .option("--json", "JSON output")
    .action(async (opts: { all?: boolean; json?: boolean }) => {
      const loaded = getLoaded();
      const base = requireMeshInbox(loaded);
      const rows = listTargetsSync(base, { all: Boolean(opts.all) });
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (!rows.length) {
        console.log("(no targets)");
        return;
      }
      for (const e of rows) {
        const kind = e.kind ?? "target";
        const parent = e.parentId ? ` under=${e.parentId.slice(0, 8)}` : "";
        console.log(
          `${e.id}\t${e.status}\t${kind}${parent}\tdeadline=${e.deadlineAt}\t${e.goal.slice(0, 72)}`,
        );
      }
      console.log(`ui: http://127.0.0.1:${meshInboxPort(loaded)}/ui/`);
    });

  target
    .command("done <id>")
    .description("Mark target finished")
    .action(async (id: string) => {
      const loaded = getLoaded();
      const base = requireMeshInbox(loaded);
      const r = await targetDone(base, id);
      if (!r.ok) {
        console.error(`FAIL: ${r.error}`);
        process.exit(1);
      }
      console.log(`ok done id=${id}`);
    });

  target
    .command("cancel <id>")
    .description("Cancel target")
    .action(async (id: string) => {
      const loaded = getLoaded();
      const base = requireMeshInbox(loaded);
      const r = await targetCancel(base, id);
      if (!r.ok) {
        console.error(`FAIL: ${r.error}`);
        process.exit(1);
      }
      console.log(`ok cancelled id=${id}`);
    });

  target
    .command("remind <id>")
    .description("Force operator toast now")
    .action(async (id: string) => {
      const loaded = getLoaded();
      const base = requireMeshInbox(loaded);
      const r = await targetRemind(base, id);
      if (!r.ok) {
        console.error(`FAIL: ${r.error}`);
        process.exit(1);
      }
      console.log(`ok remind id=${id}`);
    });

  target
    .command("triage <id>")
    .description("Peer manager/secretary to break down / balance load")
    .option("--to <seats>", "comma seats (default: target's triageTo)")
    .action(async (id: string, opts: { to?: string }) => {
      const loaded = getLoaded();
      const base = requireMeshInbox(loaded);
      const r = await targetTriage(base, id, parseTriageTo(opts.to));
      if (!r.ok) {
        console.error(`FAIL: ${r.error}`);
        process.exit(1);
      }
      console.log(`ok triage id=${id}`);
    });

  target
    .command("ui")
    .description("Print Targets UI URL for this profile's inbox")
    .action(() => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      console.log(`http://127.0.0.1:${meshInboxPort(loaded)}/ui/`);
    });

  return target;
}

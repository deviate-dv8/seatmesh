/**
 * `sm nav log|summary` (TODO 3.6) — reads the navigation history `peek <target>`
 * appends to (`@seat-mesh/core` nav-log.ts). Read-only; nothing to enqueue.
 */
import { Command } from "commander";
import { summarizeNavEntries, tailNavLog, type LoadedProfile } from "@seat-mesh/core";

export function buildNavCommands(getLoaded: () => LoadedProfile): Command {
  const nav = new Command("nav").description(
    "Navigation history — which targets peek has looked at recently",
  );

  nav
    .command("log")
    .description("Recent peek events, most recent last")
    .option("-n, --lines <n>", "entry count", "50")
    .option("--json", "JSON output")
    .action(async (opts: { lines: string; json?: boolean }) => {
      const loaded = getLoaded();
      const n = Number.parseInt(opts.lines, 10) || 50;
      const entries = await tailNavLog(loaded, n);
      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (!entries.length) {
        console.log("(no navigation history yet — run `peek <target>`)");
        return;
      }
      for (const e of entries) {
        console.log(
          `${e.at}\t${e.actor}\t${e.target}\t${e.targetPane}\trole=${e.role ?? "?"} slot=${e.slot ?? "-"}`,
        );
      }
    });

  nav
    .command("summary")
    .description("Peek targets grouped by visit count, most-recently-visited first")
    .option("-n, --lines <n>", "how much recent history to summarize", "1000")
    .option("--json", "JSON output")
    .action(async (opts: { lines: string; json?: boolean }) => {
      const loaded = getLoaded();
      const n = Number.parseInt(opts.lines, 10) || 1000;
      const entries = await tailNavLog(loaded, n);
      const rows = summarizeNavEntries(entries);
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (!rows.length) {
        console.log("(no navigation history yet — run `peek <target>`)");
        return;
      }
      for (const r of rows) {
        console.log(`${r.target}\tvisits=${r.count}\tlast=${r.lastAt}`);
      }
    });

  return nav;
}

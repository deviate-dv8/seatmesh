/**
 * `sm campaign ...` (TODO 8.2/8.4) — ticket-style campaigns, the narrowest slice
 * of the campaign-contract vision (docs/HANDOUT-CAMPAIGN-CONTRACT.md). One atomic
 * unit of work: title, objective (what "done" means), status, optional assignee.
 * No dependency graph, no supervisor/balancer roles — those stay open questions.
 */
import { Command } from "commander";
import {
  assignCampaign,
  createCampaign,
  findCampaign,
  noteCampaign,
  readCampaigns,
  setCampaignStatus,
  type CampaignRecord,
  type CampaignStatus,
  type LoadedProfile,
} from "@seat-mesh/core";

function printCampaignLine(c: CampaignRecord): void {
  console.log(
    `${c.id}\t${c.status}\t${c.title}\tassignee=${c.assignee ?? "-"}\tcreated=${c.createdAt}`,
  );
}

function printCampaignDetail(c: CampaignRecord): void {
  console.log(`id:        ${c.id}`);
  console.log(`title:     ${c.title}`);
  console.log(`objective: ${c.objective ?? "(none)"}`);
  console.log(`status:    ${c.status}`);
  console.log(`assignee:  ${c.assignee ?? "-"}`);
  console.log(`created:   ${c.createdAt}`);
  console.log(`updated:   ${c.updatedAt}`);
  if (c.doneAt) console.log(`done:      ${c.doneAt}`);
  if (c.notes.length) {
    console.log("notes:");
    for (const n of c.notes) console.log(`  ${n.at}\t${n.by ?? "?"}\t${n.note}`);
  }
}

async function requireCampaign(loaded: LoadedProfile, id: string): Promise<CampaignRecord> {
  const c = await findCampaign(loaded, id);
  if (!c) {
    console.error(`campaign not found: ${id}`);
    process.exit(1);
  }
  return c;
}

export function buildCampaignCommands(getLoaded: () => LoadedProfile): Command {
  const campaign = new Command("campaign").description(
    "Ticket-style campaigns — atomic work units with a status and an objective",
  );

  campaign
    .command("create <title>")
    .description("Create a new open campaign")
    .option("--objective <text>", "what \"done\" means for this campaign")
    .option("--assign <seat>", "assignee (seat id / persona column)")
    .option("--by <seat>", "who filed this (defaults to operator)")
    .option("--json", "JSON output")
    .action(
      async (
        title: string,
        opts: { objective?: string; assign?: string; by?: string; json?: boolean },
      ) => {
        const loaded = getLoaded();
        const c = await createCampaign(loaded, {
          title,
          objective: opts.objective,
          assignee: opts.assign,
          by: opts.by,
        });
        if (opts.json) {
          console.log(JSON.stringify(c, null, 2));
          return;
        }
        console.log(`created ${c.id}`);
        printCampaignDetail(c);
      },
    );

  campaign
    .command("list")
    .description("List campaigns, most recently created first")
    .option("--status <status>", "filter: open|done|cancelled|all", "open")
    .option("--json", "JSON output")
    .action(async (opts: { status: string; json?: boolean }) => {
      const loaded = getLoaded();
      const all = await readCampaigns(loaded);
      const rows =
        opts.status === "all" ? all : all.filter((c) => c.status === opts.status);
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (!rows.length) {
        console.log(`(no ${opts.status === "all" ? "" : `${opts.status} `}campaigns)`);
        return;
      }
      for (const c of rows) printCampaignLine(c);
    });

  campaign
    .command("show <id>")
    .description("Show one campaign's full detail, including notes")
    .option("--json", "JSON output")
    .action(async (id: string, opts: { json?: boolean }) => {
      const loaded = getLoaded();
      const c = await requireCampaign(loaded, id);
      if (opts.json) {
        console.log(JSON.stringify(c, null, 2));
        return;
      }
      printCampaignDetail(c);
    });

  campaign
    .command("assign <id> <seat>")
    .description("Assign (or reassign) a campaign to a seat")
    .option("--by <seat>", "who filed this")
    .action(async (id: string, seat: string, opts: { by?: string }) => {
      const loaded = getLoaded();
      await requireCampaign(loaded, id);
      await assignCampaign(loaded, id, seat, opts.by);
      console.log(`${id} assigned -> ${seat}`);
    });

  const setStatus = (status: CampaignStatus, verb: string) =>
    async (id: string, opts: { by?: string }) => {
      const loaded = getLoaded();
      await requireCampaign(loaded, id);
      await setCampaignStatus(loaded, id, status, opts.by);
      console.log(`${id} ${verb}`);
    };

  campaign
    .command("done <id>")
    .description("Mark a campaign done")
    .option("--by <seat>", "who filed this")
    .action(setStatus("done", "done"));

  campaign
    .command("cancel <id>")
    .description("Cancel a campaign")
    .option("--by <seat>", "who filed this")
    .action(setStatus("cancelled", "cancelled"));

  campaign
    .command("reopen <id>")
    .description("Reopen a done/cancelled campaign")
    .option("--by <seat>", "who filed this")
    .action(setStatus("open", "reopened"));

  campaign
    .command("note <id> <text>")
    .description("Append a progress note to a campaign")
    .option("--by <seat>", "who filed this")
    .action(async (id: string, text: string, opts: { by?: string }) => {
      const loaded = getLoaded();
      await requireCampaign(loaded, id);
      await noteCampaign(loaded, id, text, opts.by);
      console.log(`${id} noted`);
    });

  return campaign;
}

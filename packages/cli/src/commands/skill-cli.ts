/**
 * `seatmesh --skill` / `seatmesh skill` — a discovery/capability manifest for
 * another tool or agent (not a human reading interactively) that wants to
 * learn what seatmesh can do and how to drive it, without seatmesh needing
 * any bespoke integration code for that tool. Plain "shell out to the CLI"
 * integration: no SDK, no API server — just `npx seatmesh <cmd>` /
 * `sm <cmd>` and structured output where a command supports `--json`.
 *
 * Command list is generated from `listHelpEntries()` (the same source of
 * truth as docs/COMMANDS.md), not hand-duplicated — stays in sync with the
 * real CLI surface automatically as commands are added/removed.
 */
import { listHelpAliases, listHelpEntries } from "./help-text.js";

export interface SkillCommandEntry {
  verb: string;
  usage: string;
  description: string;
  aliases: string[];
}

export interface SkillManifest {
  name: string;
  description: string;
  whenToUse: string[];
  entryPoints: { cmd: string; why: string }[];
  integration: {
    shape: string;
    binary: string[];
    profileFlag: string;
    jsonOutput: string;
    fullDocs: string;
  };
  commandCount: number;
  commands: SkillCommandEntry[];
}

function splitBody(body: string): { usage: string; description: string } {
  const lines = body.split("\n");
  return {
    usage: (lines[0] ?? "").trim(),
    description: lines.slice(1).map((l) => l.trim()).filter(Boolean).join(" "),
  };
}

export function buildSkillManifest(): SkillManifest {
  const aliasesByVerb = new Map<string, string[]>();
  for (const { alias, verb } of listHelpAliases()) {
    if (alias === verb) continue; // self-entries aren't real aliases
    const list = aliasesByVerb.get(verb) ?? [];
    list.push(alias);
    aliasesByVerb.set(verb, list);
  }

  const commands: SkillCommandEntry[] = listHelpEntries().map(({ verb, body }) => {
    const { usage, description } = splitBody(body);
    return { verb, usage, description, aliases: aliasesByVerb.get(verb) ?? [] };
  });

  return {
    name: "seatmesh",
    description:
      "Multi-agent tmux orchestration for coding-agent CLIs (opencode, claude, " +
      "cursor-agent, kiro, custom kinds). Runs one manager/secretary + N worker/" +
      "mini seats in a single tmux session, each a real agent CLI in its own " +
      "pane, coordinated through a daemon-mediated queue (peer/room/inbox) - " +
      "producers enqueue, one daemon injects, never a raw tmux send-keys.",
    whenToUse: [
      "You want several coding-agent CLI instances working the same project in parallel, coordinated (not isolated one-offs).",
      "You want a durable, inspectable session (tmux) rather than a one-shot API call - panes stay attachable, state persists in .sm/.",
      "You want status/queue visibility (open tasks, unanswered asks, checkbacks) across many agents without polling each one by hand.",
      "You do NOT need this for a single agent working alone with no coordination need - that's just the agent CLI directly.",
    ],
    entryPoints: [
      { cmd: "npx seatmesh init && npx seatmesh start", why: "bootstrap a new mesh in a project and attach to it" },
      { cmd: "seatmesh agent whoami", why: "run inside a pane to discover this seat's own identity/role/capabilities" },
      { cmd: "seatmesh agent", why: "run inside a pane to list exactly what commands THIS seat can/cannot run" },
      { cmd: "seatmesh sessions list --json", why: "list every registered mesh on this host, machine-readable" },
      { cmd: "seatmesh web up", why: "start the operator hub (dashboard/sessions/queues/notify) - works from anywhere, no project context needed" },
      { cmd: "seatmesh --skill --json", why: "this manifest, machine-readable" },
    ],
    integration: {
      shape: "Shell out to the CLI binary - no SDK, no long-running API server to integrate against.",
      binary: ["npx seatmesh <cmd> [args] [--json]", "sm <cmd> [args] [--json]  (after: seatmesh install)"],
      profileFlag: "--profile <path-or-dir> selects a specific .sm/ config; omitted, it walks up from cwd.",
      jsonOutput: "Most read/status commands (list/show/status verbs) accept --json for structured output - check docs/cli/<verb>.md.",
      fullDocs: "docs/COMMANDS.md (generated, greppable) + docs/cli/<verb>.md (one file per command).",
    },
    commandCount: commands.length,
    commands,
  };
}

function printHuman(m: SkillManifest): void {
  console.log(`${m.name} — ${m.description}`);
  console.log("");
  console.log("when to use:");
  for (const w of m.whenToUse) console.log(`  - ${w}`);
  console.log("");
  console.log("entry points:");
  for (const e of m.entryPoints) console.log(`  ${e.cmd}\n    ${e.why}`);
  console.log("");
  console.log("integration:");
  console.log(`  ${m.integration.shape}`);
  for (const b of m.integration.binary) console.log(`  ${b}`);
  console.log(`  ${m.integration.profileFlag}`);
  console.log(`  ${m.integration.jsonOutput}`);
  console.log(`  full docs: ${m.integration.fullDocs}`);
  console.log("");
  console.log(`${m.commandCount} commands (seatmesh --skill --json for the full structured list):`);
  for (const c of m.commands.slice(0, 15)) {
    console.log(`  ${c.verb}${c.aliases.length ? ` (${c.aliases.join(",")})` : ""}\t${c.usage}`);
  }
  if (m.commands.length > 15) console.log(`  ... and ${m.commands.length - 15} more`);
}

export function runSkillCommand(json: boolean): void {
  const manifest = buildSkillManifest();
  if (json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  printHuman(manifest);
}

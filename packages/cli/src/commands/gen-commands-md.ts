#!/usr/bin/env node
/**
 * Regenerate docs/COMMANDS.md + docs/cli/<verb>.md from help-text.ts.
 * Run: node --import tsx packages/cli/src/commands/gen-commands-md.ts
 * Or:  npx vitest run packages/cli/src/commands/help-text.test.ts (asserts sync)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listHelpEntries,
  renderCliVerbMarkdown,
  renderCommandsMarkdown,
} from "./help-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const commandsPath = path.join(repoRoot, "docs/COMMANDS.md");
const cliDir = path.join(repoRoot, "docs/cli");

fs.mkdirSync(cliDir, { recursive: true });
fs.writeFileSync(commandsPath, renderCommandsMarkdown());

const keep = new Set(listHelpEntries().map((e) => `${e.verb}.md`));
keep.add("README.md");

for (const { verb } of listHelpEntries()) {
  const md = renderCliVerbMarkdown(verb);
  if (md) fs.writeFileSync(path.join(cliDir, `${verb}.md`), md);
}

for (const ent of fs.readdirSync(cliDir)) {
  if (!keep.has(ent) && ent.endsWith(".md")) {
    fs.unlinkSync(path.join(cliDir, ent));
  }
}

const readme = `# seatmesh CLI verbs (one md each)

Greppable per-command docs. Generated from \`packages/cli/src/commands/help-text.ts\`.

\`\`\`bash
ls docs/cli | rg peer
rg -n . docs/cli/peer.md
rg -n "^## " docs/COMMANDS.md
seatmesh help peer
\`\`\`

Full catalog: [../COMMANDS.md](../COMMANDS.md)

| Verb | File |
|------|------|
${listHelpEntries()
  .map(({ verb }) => `| \`${verb}\` | [${verb}.md](${verb}.md) |`)
  .join("\n")}
`;

fs.writeFileSync(path.join(cliDir, "README.md"), `${readme}\n`);
console.log(`OK: wrote ${commandsPath} + ${keep.size - 1} docs/cli/*.md`);

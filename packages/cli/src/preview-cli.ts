import { Command } from "commander";
import type { LoadedProfile } from "@seat-mesh/core";
import { parsePreviewDays, runMeshPreview } from "@seat-mesh/tmux";

export function buildPreviewCommand(getLoaded: () => LoadedProfile): Command {
  const preview = new Command("preview").description(
    "Publish markdown to mdview.io (wraps workspace publish-mdview.sh)",
  );

  preview
    .argument("<files...>", "one or more .md files")
    .option("--set <days>", "expiresInDays (1-30, default 1)", "1")
    .option("--notify", "desktop toast per published URL (sm notify)")
    .action(async (files: string[], opts: { set: string; notify?: boolean }) => {
      const loaded = getLoaded();
      const days = parsePreviewDays(opts.set);
      if (days == null) {
        console.error("FAIL usage 2: --set must be 1-30");
        process.exit(2);
      }

      const result = await runMeshPreview(loaded, {
        files,
        days,
        notify: opts.notify === true,
      });

      if (result.exitCode === 2 && result.results[0]?.error) {
        console.error(`FAIL usage 2: ${result.results[0].error}`);
        process.exit(2);
      }

      for (const row of result.results) {
        if (row.ok && row.url) {
          console.log(`ok preview ${row.file} ${row.url}`);
          if (row.error) console.error(`WARN ${row.file}: ${row.error}`);
        } else {
          console.error(`FAIL ${row.file}: ${row.error ?? "unknown"}`);
        }
      }

      process.exit(result.exitCode);
    });

  return preview;
}

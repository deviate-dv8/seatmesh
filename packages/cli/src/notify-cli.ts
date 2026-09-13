import { Command } from "commander";
import type { LoadedProfile } from "@seat-mesh/core";
import { runMeshNotify } from "@seat-mesh/tmux";

export function buildNotifyCommand(getLoaded: () => LoadedProfile): Command {
  const notify = new Command("notify").description(
    "Desktop toast for operator (seat from TMUX pane; wraps workspace notify.sh)",
  );

  notify
    .argument("<session>", "what this session is about (title body)")
    .argument("<check>", "what the operator should verify (Check: line)")
    .option("--url <url>", "optional clickable link (mdview / localhost override)")
    .action(async (session: string, check: string, opts: { url?: string }) => {
      const loaded = getLoaded();
      const result = await runMeshNotify(loaded, {
        session,
        check,
        url: opts.url?.trim() || undefined,
      });
      if (!result.ok) {
        if (result.exitCode === 2) {
          console.error(`FAIL usage ${result.exitCode}: ${result.error}`);
        } else {
          console.error(`FAIL ${result.error}`);
        }
        process.exit(result.exitCode);
      }
      console.log(`ok toast ${result.seatDisplay} "${session.trim()}"`);
    });

  return notify;
}

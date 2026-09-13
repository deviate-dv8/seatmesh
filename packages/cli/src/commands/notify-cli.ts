import { Command } from "commander";
import type { LoadedProfile } from "@seat-mesh/core";
import { runMeshNotify, sendDesktopToastSync, sendYesNoToast } from "@seat-mesh/tmux";

export function buildNotifyCommand(getLoaded: () => LoadedProfile): Command {
  const notify = new Command("notify").description(
    "Desktop toast for operator (node-notifier; Yes/No via notify-act on inbox daemon)",
  );

  notify
    .command("desktop")
    .description("Toast with explicit title and body (no tmux whoami; cross-platform via node-notifier)")
    .argument("<title>", "toast title")
    .argument("<body>", "toast body")
    .action((title: string, body: string) => {
      const loaded = getLoaded();
      const ok = sendDesktopToastSync(loaded.workspace, title.trim(), body.trim());
      if (!ok) {
        console.error("FAIL: desktop notify unavailable or muted");
        process.exit(1);
      }
      console.log(`ok desktop "${title.trim()}"`);
    });

  notify
    .command("yesno")
    .description(
      "Toast with clickable Yes/No links -> one-shot GET /act/v1 -> peer inject (default: secretary)",
    )
    .argument("<title>", "toast title")
    .argument("<body>", "toast body (above the link line)")
    .option("--yes-msg <text>", "peer message when Yes is clicked", "Dan notify reply: YES")
    .option("--target <seat>", "peer target for Yes and No", "secretary")
    .action(async (title: string, body: string, opts: { yesMsg: string; target: string }) => {
      const loaded = getLoaded();
      const ok = await sendYesNoToast(
        loaded,
        title.trim(),
        body.trim(),
        opts.yesMsg.trim(),
        opts.target.trim(),
      );
      if (!ok) {
        console.error("FAIL: toast not delivered (inbox down, muted, or act/register failed)");
        process.exit(1);
      }
      console.log(`ok yesno toast -> ${opts.target.trim()} "${title.trim()}"`);
    });

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

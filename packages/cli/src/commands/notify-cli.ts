import { Command } from "commander";
import type { LoadedProfile } from "@seat-mesh/core";
import {
  runMeshNotify,
  runNotifyDetails,
  sendDesktopToastSync,
  sendYesNoToast,
} from "@seat-mesh/tmux";

function collectImage(v: string, acc: string[]): string[] {
  acc.push(v);
  return acc;
}

export function buildNotifyCommand(getLoaded: () => LoadedProfile): Command {
  const notify = new Command("notify").description(
    "Operator toast: plain / Info (mdview) / Yes-No decide",
  );
  // Parent also has --url (eyes-only). Without this, `notify yesno … --url`
  // is stolen by the parent and yesno never sees openUrl / Open button.
  notify.enablePositionalOptions();

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
      "Info + Yes/No — Info opens agent-crafted mdview (or decide card); Yes/No peer reply seat",
    )
    .argument("<title>", "toast title")
    .argument("<body>", "short toast blurb")
    .option("--yes-msg <text>", "extra / override note on Yes peer")
    .option("--no-msg <text>", "extra / override note on No peer")
    .option(
      "--target <seat>",
      "who receives Yes/No peer (manager|secretary|slot-N|mini-N). Default: asking seat, else manager",
    )
    .option("--md <file>", "craft Info link from markdown file")
    .option("--body <markdown>", "craft Info from inline markdown (alias: --body-md)")
    .option("--body-md <markdown>", "craft Info from inline markdown")
    .option("--image <path>", "embed image in crafted Info (repeatable)", collectImage, [] as string[])
    .option("--info-url <url>", "use existing Info URL for toast Info button (skip craft)")
    .option("--url <url>", "external link → Open button on crafted Info card (alias for card openUrl)")
    .option("--days <n>", "card TTL days 1-30 (default 7)", "7")
    .action(
      async (
        title: string,
        body: string,
        opts: {
          yesMsg?: string;
          noMsg?: string;
          target?: string;
          md?: string;
          body?: string;
          bodyMd?: string;
          image: string[];
          infoUrl?: string;
          url?: string;
          days: string;
        },
      ) => {
        const loaded = getLoaded();
        const days = Number.parseInt(opts.days, 10);
        const infoBody = (opts.body ?? opts.bodyMd)?.trim() || undefined;
        const result = await sendYesNoToast(loaded, title.trim(), body.trim(), {
          yesMsg: opts.yesMsg?.trim(),
          noMsg: opts.noMsg?.trim(),
          target: opts.target?.trim(),
          infoUrl: opts.infoUrl?.trim(),
          openUrl: opts.url?.trim(),
          infoMdFile: opts.md,
          infoBody,
          infoImages: opts.image,
          infoDays: Number.isFinite(days) ? days : 7,
        });
        if (!result.ok) {
          console.error("FAIL: toast not delivered (inbox down, muted, craft/register failed)");
          process.exit(1);
        }
        console.log(
          `ok yesno toast -> ${result.target} "${title.trim()}"${result.infoUrl ? ` info=${result.infoUrl}` : ""}`,
        );
      },
    );

  const info = new Command("info")
    .alias("details")
    .alias("md")
    .description(
      "Craft an Info link on the hub (/act/card :3190) from markdown (+ images). Use yesno for actionables.",
    )
    .argument("<title>", "toast + Info title")
    .option("--md <file>", "markdown file (workspace-relative or absolute)")
    .option("--body <markdown>", "inline markdown (simple or richer)")
    .option("--image <path>", "embed local image (repeatable)", collectImage, [] as string[])
    .option("--url <url>", "external link → Open button on Info card (e.g. mdview share)")
    .option("--check <text>", "toast Check: line")
    .option("--days <n>", "card TTL days 1-30 (default 7)", "7")
    .option("--quiet", "publish only (still opens browser); skip desktop toast")
    .action(
      async (
        title: string,
        opts: {
          md?: string;
          body?: string;
          image: string[];
          url?: string;
          check?: string;
          days: string;
          quiet?: boolean;
        },
      ) => {
        const loaded = getLoaded();
        const days = Number.parseInt(opts.days, 10);
        if (!Number.isFinite(days) || days < 1 || days > 30) {
          console.error("FAIL usage 2: --days must be 1-30");
          process.exit(2);
        }
        const result = await runNotifyDetails(loaded, {
          title: title.trim(),
          mdFile: opts.md,
          body: opts.body,
          images: opts.image,
          openUrl: opts.url?.trim(),
          check: opts.check ?? "Open Info card",
          expiresInDays: days,
          quiet: opts.quiet === true,
        });
        if (!result.ok) {
          console.error(`FAIL: ${result.error}`);
          process.exit(result.exitCode);
        }
        if (result.error) console.error(`WARN: ${result.error}`);
        for (const s of result.skipped ?? []) {
          console.error(`WARN image ${s.path}: ${s.reason}`);
        }
        console.log(
          `ok info ${result.viewerUrl?.trim()}${result.embedded?.length ? ` images=${result.embedded.length}` : ""}`,
        );
      },
    );

  notify.addCommand(info);

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

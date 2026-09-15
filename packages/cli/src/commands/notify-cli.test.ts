import { describe, expect, it } from "vitest";
import { Command } from "commander";
import type { LoadedProfile } from "@seat-mesh/core";
import { buildNotifyCommand } from "./notify-cli.js";

describe("notify --url positional options", () => {
  it("commander: parent --url must not steal yesno --url (regression)", async () => {
    const seen: { url?: string } = {};
    const notify = new Command("notify");
    notify.enablePositionalOptions();
    notify
      .command("yesno")
      .argument("<title>")
      .argument("<body>")
      .option("--url <url>")
      .action((_t, _b, opts: { url?: string }) => {
        seen.url = opts.url;
      });
    notify
      .argument("<session>")
      .argument("<check>")
      .option("--url <url>")
      .action(() => {
        throw new Error("parent action should not run");
      });
    await notify.parseAsync(
      ["yesno", "t", "b", "--url", "https://example.com/x"],
      { from: "user" },
    );
    expect(seen.url).toBe("https://example.com/x");
  });

  it("buildNotifyCommand enables positional options", () => {
    const notify = buildNotifyCommand(() => ({ workspace: "/tmp" }) as LoadedProfile);
    // Commander stores this on the command after enablePositionalOptions().
    expect(
      Boolean((notify as unknown as { _enablePositionalOptions?: boolean })._enablePositionalOptions),
    ).toBe(true);
  });
});

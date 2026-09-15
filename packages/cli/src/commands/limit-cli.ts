import { Command } from "commander";
import { type LoadedProfile, chatRoomConfigForLoaded } from "@seat-mesh/core";
import { ensureMeshInbox, meshInboxPort, requireInboxLifecycleRole } from "@seat-mesh/tmux";

function requireMeshInbox(loaded: LoadedProfile): void {
  if (ensureMeshInbox(loaded, { quiet: true })) return;
  const port = meshInboxPort(loaded);
  console.error(
    `FAIL: mesh inbox down on :${port} (auto-start failed) — run: seatmesh inbox restart`,
  );
  process.exit(1);
}

function inboxBase(loaded: LoadedProfile): string {
  return chatRoomConfigForLoaded(loaded).inboxBase.replace(/\/$/, "");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body;
}

/**
 * Force CC-LIMIT (etc.) borders back to idle without cancelling armed
 * cc-limit-retry checkbacks. Manager / secretary / operator shell.
 */
export function buildLimitCommands(getLoaded: () => LoadedProfile): Command {
  const limit = new Command("limit").description(
    "Limit border overrides (CC-LIMIT → idle). Does not cancel auto checkbacks.",
  );

  limit
    .command("idle")
    .description(
      "Show idle instead of sticky CC-LIMIT/OC-LIMIT on banners (operator/manager/secretary)",
    )
    .option("--all", "all panes (default)")
    .option("--pane <id>", "one tmux pane id (%12)")
    .option("--ttl-hours <n>", "how long the override lasts", "24")
    .action(
      async (opts: { all?: boolean; pane?: string; ttlHours: string }) => {
        const loaded = getLoaded();
        requireInboxLifecycleRole(loaded, "limit idle");
        requireMeshInbox(loaded);
        const ttlHours = Number(opts.ttlHours) || 24;
        const body =
          opts.pane && !opts.all
            ? { pane: opts.pane, ttlHours }
            : { all: true, ttlHours };
        const data = await fetchJson<{ ok: boolean; override?: string; ttlMs?: number }>(
          `${inboxBase(loaded)}/limit/idle`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        console.log(
          `OK: limit-idle override=${data.override ?? "all"} ttlHours=${ttlHours} (cc-limit-retry CBs still armed)`,
        );
      },
    );

  limit
    .command("idle-clear")
    .description("Clear limit-idle override(s)")
    .option("--all", "all panes (default)")
    .option("--pane <id>", "one tmux pane id")
    .action(async (opts: { all?: boolean; pane?: string }) => {
      const loaded = getLoaded();
      requireInboxLifecycleRole(loaded, "limit idle-clear");
      requireMeshInbox(loaded);
      const body =
        opts.pane && !opts.all ? { pane: opts.pane } : { all: true };
      await fetchJson(`${inboxBase(loaded)}/limit/idle/clear`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      console.log(`OK: limit-idle override cleared (${opts.pane && !opts.all ? opts.pane : "all"})`);
    });

  return limit;
}

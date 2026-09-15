import { Command } from "commander";
import {
  type AckRow,
  type LoadedProfile,
  chatRoomConfigForLoaded,
  formatAckStatusLine,
  openAcks,
  resolveAckRedirectDefaults,
} from "@seat-mesh/core";
import { ensureMeshInbox, meshInboxPort } from "@seat-mesh/tmux";
import { runAckReply } from "./ack-reply.js";

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

function printRow(row: AckRow): void {
  console.log(formatAckStatusLine(row));
}

async function listAcks(
  loaded: LoadedProfile,
  opts: { all?: boolean; seat?: string; json?: boolean },
): Promise<void> {
  const q = new URLSearchParams();
  if (opts.all) q.set("all", "1");
  if (opts.seat) q.set("seat", opts.seat);
  const data = await fetchJson<{ entries: AckRow[] }>(
    `${inboxBase(loaded)}/ack?${q}`,
  );
  let rows = data.entries ?? [];
  if (!opts.all) rows = openAcks(rows);
  if (opts.json) {
    console.log(JSON.stringify({ entries: rows }, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(opts.all ? "no ack rows" : "no open asks");
    return;
  }
  for (const r of rows) printRow(r);
}

export function buildAckCommands(getLoaded: () => LoadedProfile): Command {
  const ack = new Command("ack").description(
    "Unanswered asks ledger — close with: ack <id>   (note optional; no peer reply required)",
  );

  ack
    .command("list")
    .alias("ls")
    .description("List open asks (default). --all includes cleared.")
    .option("--all", "include acked rows")
    .option("--seat <id>", "filter by seat (secretary, manager, worker-1)")
    .option("--json", "raw JSON")
    .action(async (opts: { all?: boolean; seat?: string; json?: boolean }) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      await listAcks(loaded, opts);
    });

  ack
    .command("reply")
    .description(
      "Peer back to the asker + close ACK in one shot (limits n+1). Default msg: ACK",
    )
    .argument("<id>", "ack id or prefix")
    .argument("[msg...]", "optional peer body (default: ACK)")
    .action(async (id: string, msgParts: string[]) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      try {
        const r = await runAckReply(loaded, id, msgParts.join(" "));
        console.log(`ok ack-reply id=${r.ackId} -> ${r.target} msg=${r.msg}`);
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });

  ack
    .command("clear")
    .description("Clear every open ask (optional --seat)")
    .option("--seat <id>", "only this seat")
    .action(async (opts: { seat?: string }) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const data = await fetchJson<{ cleared: number }>(`${inboxBase(loaded)}/ack/clear`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seat: opts.seat }),
      });
      console.log(`ok cleared=${data.cleared}`);
    });

  ack
    .argument("[id]", "ack id or prefix to clear")
    .argument("[note...]", "one-line note of what was done")
    .option("--all", "with no id: list includes cleared")
    .option("--seat <id>", "filter list by seat")
    .option("--json", "list as JSON")
    .action(
      async (
        id: string | undefined,
        noteParts: string[] | undefined,
        opts: { all?: boolean; seat?: string; json?: boolean },
      ) => {
        const loaded = getLoaded();
        requireMeshInbox(loaded);

        if (!id) {
          await listAcks(loaded, opts);
          return;
        }

        const note = (noteParts ?? []).join(" ").trim() || "closed";
        const data = await fetchJson<{ entry?: AckRow; error?: string }>(
          `${inboxBase(loaded)}/ack`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, note }),
          },
        );
        if (!data.entry) {
          console.error(`ack: FAIL ${data.error ?? "?"}`);
          process.exit(1);
        }
        console.log(`ok id=${data.entry.id} seat=${data.entry.seat} note=${note}`);
      },
    );

  ack
    .command("redirect")
    .description(
      "Arm temp block: ACK-class from <seat> to manager is rewritten to secretary (stops n+1 wrong target)",
    )
    .argument("<from>", "sender seat (mini-1, worker-2, …)")
    .option("--block <target>", "wrong recipient to block (acks.redirect.block)")
    .option("--to <seat>", "rewrite destination (acks.redirect.rewriteTo)")
    .option("--ttl-min <n>", "block lifetime minutes (acks.redirect.ttlMin)")
    .option("--reason <text>", "why armed")
    .action(
      async (
        from: string,
        opts: { block?: string; to?: string; ttlMin?: string; reason?: string },
      ) => {
        const loaded = getLoaded();
        requireMeshInbox(loaded);
        const redir = resolveAckRedirectDefaults(loaded);
        const blockTarget = (opts.block ?? "").trim() || redir.block;
        const rewriteTo = (opts.to ?? "").trim() || redir.rewriteTo;
        const ttlMin = Number(opts.ttlMin) > 0 ? Number(opts.ttlMin) : redir.ttlMin;
        const data = await fetchJson<{ ok: boolean; block: { id: string; untilMs: number } }>(
          `${inboxBase(loaded)}/ack/redirect-block`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fromSeat: from,
              blockTarget,
              rewriteTo,
              ttlMin,
              armedBy: "ack-redirect",
              reason: opts.reason,
            }),
          },
        );        const until = new Date(data.block.untilMs).toISOString();
        console.log(
          `OK: ack-redirect ${from} block=${blockTarget}→${rewriteTo} until=${until} id=${data.block.id}`,
        );
      },
    );

  ack
    .command("redirect-list")
    .description("List active ACK redirect blocks")
    .action(async () => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const data = await fetchJson<{ blocks: { id: string; fromSeat: string; blockTarget: string; rewriteTo: string; untilMs: number }[] }>(
        `${inboxBase(loaded)}/ack/redirect-block`,
      );
      if (!data.blocks?.length) {
        console.log("no ack-redirect blocks");
        return;
      }
      for (const b of data.blocks) {
        console.log(
          `${b.id}  ${b.fromSeat}  ${b.blockTarget}→${b.rewriteTo}  until=${new Date(b.untilMs).toISOString()}`,
        );
      }
    });

  ack
    .command("redirect-clear")
    .description("Clear ACK redirect block(s)")
    .argument("[from]", "optional from seat (default: all)")
    .option("--id <id>", "clear one block id")
    .action(async (from: string | undefined, opts: { id?: string }) => {
      const loaded = getLoaded();
      requireMeshInbox(loaded);
      const data = await fetchJson<{ cleared: number }>(
        `${inboxBase(loaded)}/ack/redirect-block/clear`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: opts.id, fromSeat: from }),
        },
      );
      console.log(`ok cleared=${data.cleared}`);
    });

  return ack;
}

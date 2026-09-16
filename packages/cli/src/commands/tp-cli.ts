import type { LoadedProfile } from "@seat-mesh/core";
import {
  attachTpSession,
  listTpJobs,
  listTpWorkers,
  printTpList,
  printTpWorkers,
  submitTpJob,
  watchTpJob,
} from "@seat-mesh/tmux";

export async function runTpCommand(
  loaded: LoadedProfile,
  sub: string | undefined,
  tail: string[],
): Promise<void> {
  const json = tail.includes("--json") || sub === "--json";
  const all = tail.includes("--all");
  const batch = tail.includes("--batch") || tail.includes("--no-attach");

  if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
    console.log(`tp — terminal pool (PTY workers; default interactive)

  tp run "<cmd>" [--cwd dir] [--summary text] [--batch]
  tp attach <job-id|worker-N>              interactive stdin/stdout
  tp workers [--json]                      pool status (default 2 workers)
  tp list [--all] [--json]
  tp watch [job-id]

  Interactive (default): peers attach line when job starts.
  Batch (--batch): fire-and-forget log only (no stdin).

Agents:
  seatmesh agent tp run "npm run web:test"
  seatmesh agent tp attach <job-prefix>

Config: daemon.terminalPool.concurrency in mesh.config.yaml`);
    return;
  }

  if (sub === "workers" || sub === "status") {
    if (json) {
      console.log(JSON.stringify(listTpWorkers(loaded), null, 2));
      return;
    }
    printTpWorkers(loaded);
    return;
  }

  if (sub === "list") {
    if (json) {
      console.log(JSON.stringify(listTpJobs(loaded, { all }), null, 2));
      return;
    }
    printTpList(loaded, !all);
    return;
  }

  if (sub === "attach" || sub === "connect") {
    const target = tail.find((a) => !a.startsWith("-"));
    if (!target) {
      console.error("usage: tp attach <job-id|worker-N>");
      process.exit(2);
    }
    process.exit(await attachTpSession(loaded, target));
  }

  if (sub === "run" || sub === "submit" || sub === "queue") {
    const cmd = tail.find((a) => !a.startsWith("-"));
    if (!cmd) {
      console.error('usage: tp run "<cmd>" [--cwd dir] [--summary text] [--batch]');
      process.exit(2);
    }
    const cwdIdx = tail.indexOf("--cwd");
    const cwd = cwdIdx >= 0 ? tail[cwdIdx + 1] : undefined;
    const sumIdx = tail.indexOf("--summary");
    const summary = sumIdx >= 0 ? tail[sumIdx + 1] : undefined;
    const entry = submitTpJob(loaded, cmd, {
      cwd,
      summary,
      interactive: !batch,
    });
    if (!entry) {
      console.error("tp submit failed — is inbox up? (seatmesh inbox restart)");
      process.exit(1);
    }
    console.log(`QUEUED tp ${entry.id.slice(0, 8)} — ${entry.summary ?? entry.cmd.slice(0, 72)}`);
    if (entry.interactive !== false) {
      console.log(`attach=seatmesh agent tp attach ${entry.id.slice(0, 8)}`);
    }
    console.log(`watch=seatmesh agent tp watch ${entry.id.slice(0, 8)}`);
    console.log(`workers=seatmesh agent tp workers`);
    return;
  }

  if (sub === "watch") {
    const id = tail.find((a) => !a.startsWith("-"));
    const done = watchTpJob(loaded, id);
    if (!done) process.exit(1);
    if (json) {
      console.log(JSON.stringify(done, null, 2));
      return;
    }
    console.log(`tp ${done.status} ${done.id.slice(0, 8)} exit=${done.exitCode ?? "?"}`);
    if (done.stdoutPath) console.log(`stdout=${done.stdoutPath}`);
    if (done.error) console.log(`error=${done.error}`);
    process.exit(done.status === "done" ? 0 : 1);
  }

  console.error("usage: tp run|attach|workers|list|watch …  (tp help)");
  process.exit(2);
}

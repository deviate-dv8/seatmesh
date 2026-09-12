import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  armContractLock,
  chatRoomConfigForLoaded,
  contractsDirFor,
  createRoom,
  disarmContractLock,
  isGlobalSlug,
  listContractLocks,
  loadVendorContract,
  resolveAgentId,
  type LoadedProfile,
  upsertContractRoom,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { runWhoami, secretarySupervise } from "@seat-mesh/tmux";

function tmuxOpt(pane: string, key: string): string {
  const r = spawnSync("tmux", ["display-message", "-t", pane, "-p", key], { encoding: "utf8" });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").trim();
}

function resolveFrom(loaded: LoadedProfile, explicit?: string): string {
  if (explicit) return explicit;
  const w = runWhoami(loaded);
  const mini = tmuxOpt(w.paneId ?? "", "#{@mesh_mini}");
  return resolveAgentId({ role: w.role, slot: w.slot, mini: mini || null });
}

function armSuperviseContract(loaded: LoadedProfile, agentId: string, from: string): void {
  const contractsDir = contractsDirFor(loaded);
  const doc = loadVendorContract(contractsDir, "supervise");
  if (agentId !== doc.supervisor) {
    throw new Error(
      `supervise contract binds supervisor=${doc.supervisor}, not ${agentId}`,
    );
  }
  const lock = armContractLock(contractsDir, doc.id, agentId);
  const cfg = chatRoomConfigForLoaded(loaded);
  const room = upsertContractRoom({
    workspace: loaded.workspace,
    cfg,
    slug: doc.room_slug,
    createdBy: from,
    kind: "contract",
    scope: doc.scope,
    members: doc.members,
    leads: doc.leads,
    supervisor: doc.supervisor,
  });
  const managers = upsertContractRoom({
    workspace: loaded.workspace,
    cfg,
    slug: "managers",
    createdBy: from,
    kind: "contract",
    scope: "Manager coord digest — manager + manager-2",
    members: doc.leads ?? ["manager", "manager-2"],
    leads: doc.leads,
  });
  console.log(`OK: contract ${doc.id} ON agent=${agentId}`);
  console.log(`  lock=${lock}`);
  console.log(`  room=${room.slug} supervisor=${room.supervisor ?? "-"}`);
  console.log(`  room=${managers.slug} members=${(managers.members ?? []).join(",")}`);
  try {
    const reg = createRegistryForProfile(loaded.profile);
    secretarySupervise(loaded, reg, "on", "5m");
    console.log("  secretary supervise loop armed");
  } catch (e) {
    console.log(`  secretary supervise skipped (${(e as Error).message})`);
  }
}

function disarmSuperviseContract(loaded: LoadedProfile, agentId: string): void {
  const contractsDir = contractsDirFor(loaded);
  const doc = loadVendorContract(contractsDir, "supervise");
  if (agentId !== doc.supervisor) {
    throw new Error(
      `supervise contract binds supervisor=${doc.supervisor}, not ${agentId}`,
    );
  }
  const removed = disarmContractLock(contractsDir, doc.id, agentId);
  try {
    const reg = createRegistryForProfile(loaded.profile);
    secretarySupervise(loaded, reg, "off");
  } catch {
    /* session may be down */
  }
  console.log(
    removed
      ? `OK: contract ${doc.id} OFF agent=${agentId}`
      : `OK: contract ${doc.id} already off for agent=${agentId}`,
  );
}

export function buildContractLockCommands(getLoaded: () => LoadedProfile): Command {
  const contract = new Command("contract").description(
    "Harness contracts — vendor yaml + lock files under .sm/contracts/",
  );

  contract
    .command("list")
    .description("List armed contract locks")
    .action(() => {
      const loaded = getLoaded();
      const rows = listContractLocks(contractsDirFor(loaded));
      if (!rows.length) {
        console.log("(no contract locks)");
        return;
      }
      for (const row of rows) {
        console.log(`${row.contractId}\t${row.agentId}\t${row.path}`);
      }
    });

  contract
    .command("create")
    .alias("open")
    .description("Open a named chat contract (not global)")
    .argument("<slug>", "room slug")
    .option("--scope <text>", "contract scope")
    .option("--lead <id>", "lead agent id")
    .option("--supervisor <id>", "supervisor agent id")
    .option("--members <ids>", "comma-separated member ids")
    .option("--from <id>", "creator agent id")
    .action((slug, opts) => {
      const loaded = getLoaded();
      const cfg = chatRoomConfigForLoaded(loaded);
      if (isGlobalSlug(cfg, slug)) {
        console.error(`slug "${slug}" is reserved for the global room`);
        process.exit(2);
      }
      const profile = createRoom({
        workspace: loaded.workspace,
        cfg,
        slug,
        createdBy: resolveFrom(loaded, opts.from),
        kind: "contract",
        scope: opts.scope,
        lead: opts.lead,
        supervisor: opts.supervisor,
        members: opts.members?.split(",").map((s: string) => s.trim()),
      });
      console.log(`room=${profile.slug}`);
      console.log(`createdBy=${profile.createdBy}`);
    });

  contract
    .command("on")
    .description("Arm a vendor contract (creates lock + contract room)")
    .argument("<id>", "contract id (e.g. supervise)")
    .requiredOption("--agent <id>", "agent bound to the lock (supervise: secretary)")
    .option("--from <id>", "creator agent id")
    .action((id, opts) => {
      const loaded = getLoaded();
      const from = resolveFrom(loaded, opts.from);
      if (id === "supervise") {
        armSuperviseContract(loaded, opts.agent, from);
        return;
      }
      const contractsDir = contractsDirFor(loaded);
      const doc = loadVendorContract(contractsDir, id);
      if (opts.agent !== doc.supervisor) {
        throw new Error(`contract ${id} supervisor=${doc.supervisor}, not ${opts.agent}`);
      }
      const lock = armContractLock(contractsDir, doc.id, opts.agent);
      const cfg = chatRoomConfigForLoaded(loaded);
      upsertContractRoom({
        workspace: loaded.workspace,
        cfg,
        slug: doc.room_slug,
        createdBy: from,
        kind: "contract",
        scope: doc.scope,
        members: doc.members,
        leads: doc.leads,
        supervisor: doc.supervisor,
      });
      console.log(`OK: contract ${doc.id} ON lock=${lock}`);
    });

  contract
    .command("off")
    .description("Disarm a contract lock")
    .argument("<id>", "contract id")
    .requiredOption("--agent <id>", "agent that holds the lock")
    .action((id, opts) => {
      const loaded = getLoaded();
      if (id === "supervise") {
        disarmSuperviseContract(loaded, opts.agent);
        return;
      }
      const contractsDir = contractsDirFor(loaded);
      const doc = loadVendorContract(contractsDir, id);
      if (opts.agent !== doc.supervisor) {
        throw new Error(`contract ${id} supervisor=${doc.supervisor}, not ${opts.agent}`);
      }
      const removed = disarmContractLock(contractsDir, doc.id, opts.agent);
      console.log(
        removed ? `OK: contract ${doc.id} OFF` : `OK: contract ${doc.id} already off`,
      );
    });

  return contract;
}

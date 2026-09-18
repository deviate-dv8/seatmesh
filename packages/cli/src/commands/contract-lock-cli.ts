import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import YAML from "yaml";
import {
  armContractLock,
  chatRoomConfigForLoaded,
  contractsDirFor,
  createRoom,
  defaultContractAgent,
  disarmContractLock,
  isBalanceContractOn,
  isContractLocked,
  isGlobalSlug,
  isSuperviseContractOn,
  listContractLocks,
  listVendorContractIds,
  loadBalanceVendorContract,
  loadVendorContract,
  resolveAgentId,
  upsertContractRoom,
  vendorContractPath,
  type LoadedProfile,
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

function printStatus(loaded: LoadedProfile): void {
  const dir = contractsDirFor(loaded);
  const ids = listVendorContractIds(dir);
  const locks = listContractLocks(dir);
  if (!ids.length) {
    console.log("(no vendor contracts under .sm/contracts/_vendor/)");
    console.log("tip: seatmesh update  ·  or ensureVendorContracts");
    return;
  }
  console.log(`contracts  dir=${dir}`);
  for (const id of ids) {
    let agent = "?";
    let on = false;
    let extra = "";
    try {
      if (id === "balance") {
        const doc = loadBalanceVendorContract(dir);
        agent = doc.balance_lead;
        on = isBalanceContractOn(loaded);
        extra = ` lead=${doc.balance_lead} main=${doc.main_lead} balancees=${doc.balancees.join(",")}`;
      } else {
        const doc = loadVendorContract(dir, id);
        agent = doc.supervisor;
        on = isContractLocked(dir, doc.id, doc.supervisor);
        if (id === "supervise") on = isSuperviseContractOn(loaded);
        extra = ` supervisor=${doc.supervisor} leads=${(doc.leads ?? []).join(",") || "-"}`;
      }
    } catch (e) {
      extra = ` ERR=${(e as Error).message}`;
    }
    console.log(`${on ? "ON " : "off"}  ${id.padEnd(12)} agent=${agent}${extra}`);
  }
  if (locks.length) {
    console.log("--- locks ---");
    for (const row of locks) {
      console.log(`  ${row.contractId}\t${row.agentId}\t${row.path}`);
    }
  } else {
    console.log("--- locks --- (none)");
  }
  console.log("tip: contract on supervise   ·  contract on balance   ·  contract show <id>");
}

function printShow(loaded: LoadedProfile, id: string): void {
  const dir = contractsDirFor(loaded);
  const vendor = vendorContractPath(dir, id);
  if (!fs.existsSync(vendor)) {
    console.error(`vendor contract missing: ${vendor}`);
    process.exit(2);
  }
  const raw = YAML.parse(fs.readFileSync(vendor, "utf8")) as Record<string, unknown>;
  const extendPath = path.join(dir, `${id}.extend.yaml`);
  if (fs.existsSync(extendPath)) {
    Object.assign(raw, YAML.parse(fs.readFileSync(extendPath, "utf8")) as Record<string, unknown>);
  }
  let on = false;
  let bind = "";
  try {
    bind = defaultContractAgent(dir, id);
    on =
      id === "balance"
        ? isBalanceContractOn(loaded)
        : isContractLocked(dir, id, bind);
  } catch {
    /* */
  }
  console.log(`id=${id}  armed=${on ? "ON" : "off"}  bind=${bind || "-"}`);
  console.log(`vendor=${vendor}`);
  if (fs.existsSync(extendPath)) console.log(`extend=${extendPath}`);
  console.log("---");
  console.log(YAML.stringify(raw).trimEnd());
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
    scope: "Manager coord digest — profile manager columns",
    members: doc.leads ?? ["manager"],
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

function armBalanceContract(loaded: LoadedProfile, agentId: string, from: string): void {
  const contractsDir = contractsDirFor(loaded);
  const doc = loadBalanceVendorContract(contractsDir);
  if (agentId !== doc.balance_lead) {
    throw new Error(
      `balance contract binds balance_lead=${doc.balance_lead}, not ${agentId}`,
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
    members: [doc.main_lead, doc.balance_lead, ...doc.balancees],
    leads: [doc.main_lead, doc.balance_lead],
    supervisor: doc.balance_lead,
  });
  console.log(`OK: contract ${doc.id} ON agent=${agentId}`);
  console.log(`  lock=${lock}`);
  console.log(`  room=${room.slug} balance_lead=${doc.balance_lead} main=${doc.main_lead}`);
  console.log(`  balancees=${doc.balancees.join(",")}`);
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
    "Harness contracts — vendor yaml + locks under .sm/contracts/\n" +
      "  status (default) · show <id> · on|off <id> · create <slug>",
  );

  contract
    .command("status")
    .alias("list")
    .description("Vendor contracts + armed locks (default when bare: contract)")
    .action(() => {
      printStatus(getLoaded());
    });

  contract
    .command("show")
    .description("Print merged vendor (+ extend) yaml for one contract")
    .argument("<id>", "contract id (supervise|balance|…)")
    .action((id: string) => {
      printShow(getLoaded(), id);
    });

  contract
    .command("create")
    .alias("open")
    .description("Open a named chat contract room (not a vendor lock)")
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
    .description("Arm a vendor contract (lock + room). Agent defaults from yaml.")
    .argument("<id>", "contract id (supervise|balance)")
    .option("--agent <id>", "bind agent (default: supervisor / balance_lead)")
    .option("--from <id>", "creator agent id")
    .action((id, opts) => {
      const loaded = getLoaded();
      const from = resolveFrom(loaded, opts.from);
      const contractsDir = contractsDirFor(loaded);
      const agent = String(opts.agent ?? defaultContractAgent(contractsDir, id)).trim();
      if (id === "supervise") {
        armSuperviseContract(loaded, agent, from);
        return;
      }
      if (id === "balance") {
        armBalanceContract(loaded, agent, from);
        return;
      }
      // Generic supervise-shaped vendor
      const doc = loadVendorContract(contractsDir, id);
      if (agent !== doc.supervisor) {
        throw new Error(`contract ${id} supervisor=${doc.supervisor}, not ${agent}`);
      }
      const lock = armContractLock(contractsDir, doc.id, agent);
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
    .description("Disarm a contract lock. Agent defaults from yaml.")
    .argument("<id>", "contract id")
    .option("--agent <id>", "agent that holds the lock (default from yaml)")
    .action((id, opts) => {
      const loaded = getLoaded();
      const contractsDir = contractsDirFor(loaded);
      const agent = String(opts.agent ?? defaultContractAgent(contractsDir, id)).trim();
      if (id === "supervise") {
        disarmSuperviseContract(loaded, agent);
        return;
      }
      if (id === "balance") {
        const doc = loadBalanceVendorContract(contractsDir);
        if (agent !== doc.balance_lead) {
          throw new Error(`balance binds balance_lead=${doc.balance_lead}, not ${agent}`);
        }
        const removed = disarmContractLock(contractsDir, doc.id, agent);
        console.log(removed ? `OK: contract ${doc.id} OFF` : `OK: contract ${doc.id} already off`);
        return;
      }
      const doc = loadVendorContract(contractsDir, id);
      if (agent !== doc.supervisor) {
        throw new Error(`contract ${id} supervisor=${doc.supervisor}, not ${agent}`);
      }
      const removed = disarmContractLock(contractsDir, doc.id, agent);
      console.log(removed ? `OK: contract ${doc.id} OFF` : `OK: contract ${doc.id} already off`);
    });

  return contract;
}

import fs from "node:fs";
import path from "node:path";
import {
  contractsDirFor,
  listContractLocks,
  type AgentApplyBundle,
  type ParseAgentApplyOptions,
  preflightAgentBundle,
  serializeAgentApplyBundleYaml,
  agentApplyBundleDocument,
} from "@seat-mesh/core";
import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { balanceLeadCommand } from "../balance/balance-lead.js";
import { secretarySupervise } from "../roles/secretary.js";
import { runAssign } from "../seats/seat-assign.js";
import { appendTask } from "../seats/seat-update.js";
import { parseSeatTarget } from "../seats/seat-paths.js";

function locksByAgent(loaded: LoadedProfile): Map<string, string[]> {
  const dir = contractsDirFor(loaded);
  const map = new Map<string, string[]>();
  for (const row of listContractLocks(dir)) {
    const list = map.get(row.agentId) ?? [];
    list.push(row.contractId);
    map.set(row.agentId, list);
  }
  return map;
}

function writeActiveBundle(loaded: LoadedProfile, bundle: AgentApplyBundle): string {
  const dir = path.join(contractsDirFor(loaded), "active");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const doc = agentApplyBundleDocument(bundle);
  const p = path.join(dir, `apply-${stamp}.yaml`);
  fs.writeFileSync(p, serializeAgentApplyBundleYaml(bundle, String(doc.id)) + "\n");
  return p;
}

function appendInstructionTasks(
  loaded: LoadedProfile,
  leadAgentId: string,
  instructions: AgentApplyBundle["instructions"],
): void {
  if (!instructions.length) return;
  const target = parseSeatTarget(
    leadAgentId,
  );
  const sorted = [...instructions].sort((a, b) => a.index - b.index);
  for (const ins of sorted) {
    appendTask(loaded, target, `[instruction[${ins.index}]] ${ins.text}`);
  }
}

/** Apply parsed bundle — dry-run / preflight print only; else arm known vendor paths. */
export function applyAgentContractBundle(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  bundle: AgentApplyBundle,
  opts: ParseAgentApplyOptions,
): void {
  const pre = preflightAgentBundle(bundle, locksByAgent(loaded));
  if (opts.dryRun || opts.preflight) {
    console.log(JSON.stringify({ bundle, preflight: pre, opts }, null, 2));
    if (opts.preflight) {
      for (const row of pre) {
        console.log(
          `preflight ${row.agentId} load=${row.load} existing=[${row.existingLocks.join(",")}] wouldAdd=[${row.wouldAdd.join(",")}]`,
        );
      }
    }
    return;
  }

  const pathWritten = writeActiveBundle(loaded, bundle);
  console.log(`OK: bundle ${pathWritten}`);

  for (const b of bundle.balance) {
    const lead = b.balanceLead?.trim();
    if (!lead) {
      console.log("SKIP: balance lead missing");
      continue;
    }
    balanceLeadCommand(loaded, registry, "on", b.interval ?? "10m");
  }

  for (const s of bundle.supervise) {
    if (s.supervisor === "secretary") {
      secretarySupervise(loaded, registry, "on", s.interval ?? "10m");
    } else {
      console.log(
        `SKIP: dynamic supervise supervisor=${s.supervisor} (use secretary or extend vendor)`,
      );
    }
  }

  const leadForInstructions =
    bundle.balance[0]?.balanceLead ?? bundle.supervise[0]?.supervisor ?? "manager";
  appendInstructionTasks(loaded, leadForInstructions, bundle.instructions);

  if (opts.assign) {
    for (const ins of bundle.instructions) {
      const targets = ins.assignTo ?? bundle.balance[0]?.balancees ?? [];
      for (const t of targets) {
        const r = runAssign(loaded, t, ins.text);
        console.log(`assign ${t} token=${r.token ?? "-"}`);
      }
    }
  }

  if (bundle.traffic.length) {
    console.log("NOTE: traffic deny rules stored in bundle only — fan-out wiring is next slice");
  }
}

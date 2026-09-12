import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { LoadedProfile } from "../profile.js";
import { buildResolvedPaths } from "../paths-manifest.js";

export const SuperviseContractSchema = z.object({
  id: z.string().min(1),
  room_slug: z.string().min(1),
  supervisor: z.string().min(1),
  members: z.array(z.string()).min(1),
  leads: z.array(z.string()).optional(),
  scope: z.string().optional(),
  guards: z
    .object({
      deny: z.array(z.string()).default([]),
    })
    .optional(),
});

export type SuperviseContract = z.infer<typeof SuperviseContractSchema>;

export function contractsDirFor(loaded: LoadedProfile): string {
  return buildResolvedPaths(loaded).contractsDir;
}

export function vendorContractPath(contractsDir: string, id: string): string {
  return path.join(contractsDir, "_vendor", `${id}.yaml`);
}

export function loadVendorContract(contractsDir: string, id: string): SuperviseContract {
  const p = vendorContractPath(contractsDir, id);
  if (!fs.existsSync(p)) {
    throw new Error(`vendor contract missing: ${p}`);
  }
  const raw = YAML.parse(fs.readFileSync(p, "utf8"));
  return SuperviseContractSchema.parse(raw);
}

export function contractLockPath(
  contractsDir: string,
  contractId: string,
  agentId: string,
): string {
  return path.join(contractsDir, "locks", contractId, `${agentId}.on`);
}

export function isContractLocked(
  contractsDir: string,
  contractId: string,
  agentId: string,
): boolean {
  return fs.existsSync(contractLockPath(contractsDir, contractId, agentId));
}

export function armContractLock(
  contractsDir: string,
  contractId: string,
  agentId: string,
): string {
  const lock = contractLockPath(contractsDir, contractId, agentId);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, `${new Date().toISOString()}\n`);
  return lock;
}

export function disarmContractLock(
  contractsDir: string,
  contractId: string,
  agentId: string,
): boolean {
  const lock = contractLockPath(contractsDir, contractId, agentId);
  if (!fs.existsSync(lock)) return false;
  fs.unlinkSync(lock);
  return true;
}

export interface ContractLockRow {
  contractId: string;
  agentId: string;
  path: string;
}

export function listContractLocks(contractsDir: string): ContractLockRow[] {
  const locksRoot = path.join(contractsDir, "locks");
  if (!fs.existsSync(locksRoot)) return [];
  const out: ContractLockRow[] = [];
  for (const contractId of fs.readdirSync(locksRoot)) {
    const dir = path.join(locksRoot, contractId);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".on")) {
        out.push({
          contractId,
          agentId: f.slice(0, -3),
          path: path.join(dir, f),
        });
      }
    }
  }
  return out.sort((a, b) => a.contractId.localeCompare(b.contractId));
}

export function superviseLockPath(loaded: LoadedProfile): string {
  const doc = loadVendorContract(contractsDirFor(loaded), "supervise");
  return contractLockPath(contractsDirFor(loaded), doc.id, doc.supervisor);
}

export function isSuperviseContractOn(loaded: LoadedProfile): boolean {
  try {
    const doc = loadVendorContract(contractsDirFor(loaded), "supervise");
    return isContractLocked(contractsDirFor(loaded), doc.id, doc.supervisor);
  } catch {
    return false;
  }
}

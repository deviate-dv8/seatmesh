import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { LoadedProfile } from "../profile/profile.js";
import {
  contractLockPath,
  contractsDirFor,
  isContractLocked,
  vendorContractPath,
} from "./supervise.js";

export const BalanceContractSchema = z.object({
  id: z.string().min(1),
  room_slug: z.string().min(1),
  balance_lead: z.string().min(1),
  main_lead: z.string().min(1),
  balancees: z.array(z.string()).min(1),
  interval: z.string().default("10m"),
  scope: z.string().optional(),
  /** When true (default), daemon tick runs ./sm.sh-equivalent assign on pull (no manual peer). */
  auto_assign: z.boolean().default(true),
});

export type BalanceContract = z.infer<typeof BalanceContractSchema>;

export function loadBalanceVendorContract(
  contractsDir: string,
  contractId = "balance",
): BalanceContract {
  const p = vendorContractPath(contractsDir, contractId);
  if (!fs.existsSync(p)) {
    throw new Error(`vendor contract missing: ${p}`);
  }
  const raw = YAML.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  const extendPath = path.join(contractsDir, `${contractId}.extend.yaml`);
  if (fs.existsSync(extendPath)) {
    const ext = YAML.parse(fs.readFileSync(extendPath, "utf8")) as Record<string, unknown>;
    Object.assign(raw, ext);
  }
  return BalanceContractSchema.parse(raw);
}

export function balanceLockPath(loaded: LoadedProfile, contractId = "balance"): string {
  const doc = loadBalanceVendorContract(contractsDirFor(loaded), contractId);
  return contractLockPath(contractsDirFor(loaded), doc.id, doc.balance_lead);
}

export function isBalanceContractOn(loaded: LoadedProfile, contractId = "balance"): boolean {
  try {
    const doc = loadBalanceVendorContract(contractsDirFor(loaded), contractId);
    return isContractLocked(contractsDirFor(loaded), doc.id, doc.balance_lead);
  } catch {
    return false;
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  armContractLock,
  isContractLocked,
} from "./supervise.js";
import { loadBalanceVendorContract } from "./balance.js";

const BALANCE_VENDOR = `# LOCKED
id: balance
room_slug: balance
balance_lead: manager-2
main_lead: manager
interval: 10m
balancees:
  - slot-5
  - slot-6
scope: Work allocation
`;

describe("balance contract (vendor template)", () => {
  it("parses balance_lead and balancees", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-balance-"));
    const vendor = path.join(dir, "_vendor");
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, "balance.yaml"), BALANCE_VENDOR);
    const doc = loadBalanceVendorContract(dir);
    expect(doc.id).toBe("balance");
    expect(doc.balance_lead).toBe("manager-2");
    expect(doc.main_lead).toBe("manager");
    expect(doc.balancees).toEqual(["slot-5", "slot-6"]);
  });

  it("lock path convention", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-balance-lock-"));
    expect(isContractLocked(dir, "balance", "manager-2")).toBe(false);
    const lock = armContractLock(dir, "balance", "manager-2");
    expect(lock).toMatch(/locks\/balance\/manager-2\.on$/);
    expect(isContractLocked(dir, "balance", "manager-2")).toBe(true);
  });
});

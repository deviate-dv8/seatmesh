import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  armContractLock,
  contractLockPath,
  isContractLocked,
  loadVendorContract,
  SuperviseContractSchema,
} from "./supervise.js";

const SUPERVISE_VENDOR = `# LOCKED — refreshed by npx seatmesh update
id: supervise
room_slug: supervise
supervisor: secretary
members:
  - manager
  - manager-2
  - secretary
leads:
  - manager
  - manager-2
scope: Framework queue + minis throughput — not product merge or QA column moves
guards:
  deny: []
`;

describe("supervise contract (vendor template)", () => {
  it("parses and names secretary as supervisor", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-contract-"));
    const vendor = path.join(dir, "_vendor");
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, "supervise.yaml"), SUPERVISE_VENDOR);
    const doc = loadVendorContract(dir, "supervise");
    expect(doc.id).toBe("supervise");
    expect(doc.supervisor).toBe("secretary");
    expect(doc.leads).toContain("manager");
    expect(doc.leads).toContain("manager-2");
  });

  it("lock path convention", () => {
    const contractsDir = path.join(".sm", "contracts");
    const lock = contractLockPath(contractsDir, "supervise", "secretary");
    expect(lock).toMatch(/locks\/supervise\/secretary\.on$/);
  });

  it("arm and disarm lock file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-lock-"));
    const vendor = path.join(dir, "_vendor");
    fs.mkdirSync(vendor, { recursive: true });
    fs.writeFileSync(path.join(vendor, "supervise.yaml"), SUPERVISE_VENDOR);
    expect(isContractLocked(dir, "supervise", "secretary")).toBe(false);
    const lock = armContractLock(dir, "supervise", "secretary");
    expect(fs.existsSync(lock)).toBe(true);
    expect(isContractLocked(dir, "supervise", "secretary")).toBe(true);
  });
});

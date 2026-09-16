import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureVendorContracts, loadVendorContract } from "./index.js";
import { loadBalanceVendorContract } from "./balance.js";

describe("ensureVendorContracts", () => {
  it("seeds supervise + balance when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-ensure-"));
    const r = ensureVendorContracts(dir);
    expect(r.wrote.length).toBe(2);
    expect(loadVendorContract(dir, "supervise").supervisor).toBe("secretary");
    expect(loadBalanceVendorContract(dir).balance_lead).toBe("manager-2");
    const r2 = ensureVendorContracts(dir);
    expect(r2.wrote.length).toBe(0);
  });
});

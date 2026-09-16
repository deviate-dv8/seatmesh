/**
 * Built-in vendor contract YAML — seed when `_vendor/` is missing.
 * Kept in sync with packages/cli/templates/init/contracts/_vendor/.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SUPERVISE_VENDOR_YAML = `# LOCKED — refreshed by seatmesh update
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

export const DEFAULT_BALANCE_VENDOR_YAML = `# LOCKED — refreshed by seatmesh update
id: balance
room_slug: balance
balance_lead: manager-2
main_lead: manager
interval: 10m
balancees:
  - slot-5
  - slot-6
scope: Work allocation across balancees
auto_assign: true
`;

const DEFAULTS: Record<string, string> = {
  supervise: DEFAULT_SUPERVISE_VENDOR_YAML,
  balance: DEFAULT_BALANCE_VENDOR_YAML,
};

/** Write missing `_vendor/<id>.yaml` only — never overwrite operator/update copies. */
export function ensureVendorContracts(contractsDir: string): { wrote: string[] } {
  const wrote: string[] = [];
  const vendor = path.join(contractsDir, "_vendor");
  fs.mkdirSync(vendor, { recursive: true });
  fs.mkdirSync(path.join(contractsDir, "locks"), { recursive: true });
  for (const [id, body] of Object.entries(DEFAULTS)) {
    const dest = path.join(vendor, `${id}.yaml`);
    if (fs.existsSync(dest)) continue;
    fs.writeFileSync(dest, body, "utf8");
    wrote.push(dest);
  }
  return { wrote };
}

import fs from "node:fs";
import path from "node:path";
import { buildResolvedPaths, seatDirSegment, type LoadedProfile } from "@seat-mesh/core";
import { gateQueuePath } from "./seat-paths.js";

const GATE_QUEUE_TEMPLATE = `# serial gate queue (canonical — fresh agents start here)

**Updated:** 2026-09-12
**Rule:** Read this + your seat FOCUS/TASKS — not inbox scrollback. Run \`seatmesh --profile .sm agent whoami\` every turn. CLI card: \`.sm/AGENTS.md\`.

| # | Slice | Owner | Status | Evidence / next |
|---|-------|-------|--------|-----------------|
| 6 | overview-metrics alert scope | worker-6 | **OPEN** | Mirror login.block.ts in overview-metrics.block.ts |
| 7 | full-gate playwright | mini-1 | **BLOCKED** on #6 | After worker-6 DONE |
`;

export interface SeatInitResult {
  /** Paths that gained at least one new file this run. */
  created: string[];
  /** All seat dirs touched (exist now). */
  ensured: string[];
}

function ensureDirTrio(dir: string, stamp: string): boolean {
  let anyNew = false;
  fs.mkdirSync(dir, { recursive: true });
  const trio: Record<string, string> = {
    "FOCUS.md": `# ${path.basename(dir)} FOCUS

**Mark:** OPEN
**Updated:** ${stamp}

## NOW

Run \`seatmesh --profile .sm agent whoami\` — cold-start block has GATE-QUEUE + open TASKS.
`,
    "TASKS.md": `# ${path.basename(dir)} TASKS

## Open

(none)

## Done (recent)

`,
    "REMINDER.md": `# ${path.basename(dir)} REMINDER

`,
  };
  for (const [name, body] of Object.entries(trio)) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, body);
      anyNew = true;
    }
  }
  return anyNew;
}

/** Idempotent: create missing seat trio + GATE-QUEUE only — never overwrite live FOCUS/TASKS. */
export function runSeatInit(loaded: LoadedProfile): SeatInitResult {
  const root = buildResolvedPaths(loaded).seatsRoot;
  const dirs = loaded.profile.seats.dirs;
  const created: string[] = [];
  const ensured: string[] = [];
  const stamp = new Date().toISOString().slice(0, 10);

  for (let n = 1; n <= loaded.profile.session.workerCount; n++) {
    const pat = dirs?.worker ?? "slot-{n}";
    const d = path.join(root, pat.replace("{n}", String(n)));
    if (ensureDirTrio(d, stamp)) created.push(d);
    ensured.push(d);
  }

  const coordDirs: string[] = [];
  for (const col of loaded.profile.layout?.base.columns ?? ["manager", "secretary"]) {
    coordDirs.push(seatDirSegment(dirs, col));
  }
  for (const name of [...new Set(coordDirs)]) {
    const d = path.join(root, name);
    if (ensureDirTrio(d, stamp)) created.push(d);
    ensured.push(d);
  }

  const miniPat = dirs?.mini ?? "mini-{n}";
  if (!miniPat.endsWith(".json")) {
    for (let n = 1; n <= loaded.profile.session.miniMax; n++) {
      const d = path.join(root, miniPat.replace("{n}", String(n)));
      if (ensureDirTrio(d, stamp)) created.push(d);
      ensured.push(d);
    }
  }

  const gq = gateQueuePath(loaded);
  if (!fs.existsSync(gq)) {
    fs.mkdirSync(path.dirname(gq), { recursive: true });
    fs.writeFileSync(gq, GATE_QUEUE_TEMPLATE);
    created.push(gq);
  }
  ensured.push(gq);

  return { created, ensured };
}

/** Called on every session up / reload — safe to run repeatedly. */
export function ensureSeatFiles(loaded: LoadedProfile): SeatInitResult {
  return runSeatInit(loaded);
}

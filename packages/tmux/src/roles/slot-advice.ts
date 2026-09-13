import fs from "node:fs";
import path from "node:path";
import { portsForSlot, type LoadedProfile } from "@seat-mesh/core";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";
import { requireMeshManager } from "../inject/remind.js";
import { seatFile } from "../seats/seat-paths.js";

type ApiKind = "backlogged" | "nested-D-R" | "shared-db" | "isolated-db" | "odd-suffix";
type AppKind = "backlogged" | "paired" | "odd-pair" | "main-api";

function listMatching(parent: string, prefix: string): string[] {
  if (!fs.existsSync(parent)) return [];
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => e.name)
    .sort();
}

function classifyApi(name: string, slot: number, prefix: string): [ApiKind, string] {
  if (name.startsWith("X-")) return ["backlogged", "excluded from compose"];
  const body = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const parts = body.split("-");
  if (
    parts.length >= 2 &&
    /^\d+$/.test(parts[parts.length - 1]!) &&
    /^\d+$/.test(parts[parts.length - 2]!)
  ) {
    const d = Number(parts[parts.length - 2]);
    const r = Number(parts[parts.length - 1]);
    const db = d !== 0 ? "isolated Postgres" : "shared Postgres";
    const redis = r ? `private Redis id=${r}` : "shared Redis (R=0 unusual)";
    return ["nested-D-R", `${db}; ${redis}`];
  }
  if (parts.length && /^\d+$/.test(parts[parts.length - 1]!)) {
    const suf = Number(parts[parts.length - 1]);
    if (suf === 0) return ["shared-db", "shared Postgres + shared Redis (suffix -0)"];
    if (suf === slot) return ["isolated-db", "isolated Postgres; shared Redis"];
    return ["odd-suffix", `trailing -${suf} (expected -${slot} for isolated DB or nested -D-R)`];
  }
  return ["shared-db", "shared Postgres + shared Redis (no DB/Redis suffix)"];
}

function classifyApp(name: string, slot: number, prefix: string): [AppKind, string] {
  if (name.startsWith("X-")) return ["backlogged", "excluded from compose"];
  const body = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const parts = body.split("-");
  if (parts.length && /^\d+$/.test(parts[parts.length - 1]!)) {
    const suf = Number(parts[parts.length - 1]);
    if (suf === slot) return ["paired", `paired to api-feature${slot}`];
    return ["odd-pair", `trailing -${suf} (pair suffix must equal slot ${slot})`];
  }
  return ["main-api", "uses main API :3001 (not paired)"];
}

export function buildSlotAdviceReport(loaded: LoadedProfile, slot: number): string {
  const workspace = loaded.workspace;
  const prefix = `${slot}-`;
  const apiFeat = path.join(workspace, "zsign-api", "feature");
  const appFeat = path.join(workspace, "zsign-app", "feature");
  const focusPath = seatFile(loaded, { role: "worker", slot: String(slot) }, "FOCUS.md");
  const focus =
    focusPath && fs.existsSync(focusPath)
      ? fs.readFileSync(focusPath, "utf8")
      : "";
  const focusL = focus.toLowerCase();

  const wantsDestructive = /\b(destructive|renam(e|ing)|drop\s+column|drop\s+table|migration)\b/.test(
    focusL,
  );
  const wantsRedis = /\b(redis|bull|queue|deadline.?job|unique redis|private redis)\b/.test(
    focusL,
  );
  const mentionsApi = /\b(api|backend|nestjs|typeorm|migration)\b/.test(focusL);
  const mentionsApp = /\b(app|frontend|next|ui|embed)\b/.test(focusL);

  const apiDirs = listMatching(apiFeat, prefix);
  const appDirs = listMatching(appFeat, prefix);
  const ports = portsForSlot(loaded.profile.ports.worker, slot);

  const lines: string[] = [];
  lines.push(`SLOT ADVICE — slot ${slot} (ports ${ports} paired)`);
  lines.push(`FOCUS: ${focusPath ?? "(missing)"}`);
  lines.push("");
  lines.push("On-disk worktrees:");
  if (!apiDirs.length && !appDirs.length) {
    lines.push("  (none under zsign-api/feature or zsign-app/feature for this slot prefix)");
  }
  for (const n of apiDirs) {
    const [kind, desc] = classifyApi(n, slot, prefix);
    lines.push(`  api  ${n}  [${kind}] ${desc}`);
  }
  for (const n of appDirs) {
    const [kind, desc] = classifyApp(n, slot, prefix);
    lines.push(`  app  ${n}  [${kind}] ${desc}`);
  }

  lines.push("");
  lines.push("FOCUS hints:");
  lines.push(`  migration/destructive language: ${wantsDestructive ? "yes" : "no/unclear"}`);
  lines.push(`  redis/bull/queue language: ${wantsRedis ? "yes" : "no/unclear"}`);
  lines.push(`  mentions api/backend: ${mentionsApi ? "yes" : "no/unclear"}`);
  lines.push(`  mentions app/frontend: ${mentionsApp ? "yes" : "no/unclear"}`);

  const recs: string[] = [];
  const apiKinds = apiDirs.map((n) => classifyApi(n, slot, prefix)[0]);
  const appKinds = appDirs.map((n) => classifyApp(n, slot, prefix)[0]);

  if (wantsDestructive && apiDirs.length && apiKinds.every((k) => k === "shared-db")) {
    recs.push(
      "RISK: FOCUS suggests migrations but API worktree looks SHARED DB. " +
        "Destructive/renaming migrations must isolate BEFORE first migration:run / container boot. " +
        "Fix: ./scripts/clone-feature-db.sh <slug> (folder becomes N-<slug>-N).",
    );
  } else if (wantsDestructive && !apiDirs.length) {
    recs.push(
      "FOCUS suggests migrations but no api feature folder for this slot. " +
        "Create isolated api worktree first (clone-feature-db / new-feature-worktree), do not run migrations on main.",
    );
  } else if (
    wantsDestructive &&
    apiKinds.some((k) => k === "isolated-db" || k === "nested-D-R")
  ) {
    recs.push(
      "OK-ish: destructive language + isolated (or nested) API DB suffix present. Still confirm before migration:run.",
    );
  }

  if (wantsRedis && apiDirs.length && !apiKinds.some((k) => k === "nested-D-R")) {
    recs.push(
      "RISK: FOCUS suggests Redis/Bull isolation needs but API folder is not nested -D-R. " +
        "Unique Redis requires N-<slug>-D-R (e.g. -0-1 for shared DB + private Redis). " +
        "See .agent/local-dev.md.",
    );
  } else if (wantsRedis && apiKinds.some((k) => k === "nested-D-R")) {
    recs.push("OK-ish: Redis language + nested -D-R API folder present.");
  }

  if (apiDirs.length && appDirs.length) {
    if (
      apiKinds.some((k) => k === "isolated-db" || k === "nested-D-R") &&
      appKinds.some((k) => k === "main-api")
    ) {
      recs.push(
        "WARN: API looks isolated/paired-intent but APP is unpaired (main :3001). " +
          "For a paired feature FE, app folder should be N-<slug>-N matching the slot.",
      );
    }
    if (appKinds.some((k) => k === "paired") && !apiDirs.length) {
      recs.push("WARN: APP is paired suffix but no API feature folder for this slot.");
    }
  }

  if (!recs.length) {
    if (!apiDirs.length && !appDirs.length) {
      recs.push(
        "No worktrees yet for this slot. Before coding: pick shared vs isolated DB at creation time; " +
          "if migrations may be destructive/renaming, isolate from the start.",
      );
    } else {
      recs.push(
        "No hard mismatch from FOCUS heuristics. Still confirm with worker: shared DB only for additive migrations; " +
          "isolate for destructive/renaming; nested -D-R for private Redis.",
      );
    }
  }

  lines.push("");
  lines.push("Advice:");
  for (const r of recs) lines.push(`  - ${r}`);
  lines.push("");
  lines.push("Canonical rules: .agent/local-dev.md (worktrees / isolated Postgres / Redis).");
  return lines.join("\n");
}

export interface SlotAdviceOptions {
  send?: boolean;
  note?: string;
}

export function runSlotAdvice(
  loaded: LoadedProfile,
  target: string,
  opts: SlotAdviceOptions = {},
): { slot: number; report: string; sent: boolean } {
  requireMeshManager(loaded);

  const m = target.match(/^(?:slot-)?(\d+)$/);
  if (!m) {
    throw new Error(`slot-advice target must be slot 1-${loaded.profile.session.workerCount} or slot-N`);
  }
  const slot = Number(m[1]);
  if (slot < 1 || slot > loaded.profile.session.workerCount) {
    throw new Error(`slot-advice target must be slot 1-${loaded.profile.session.workerCount}`);
  }

  const resolved = resolvePaneTarget(String(slot), loaded);
  if ("error" in resolved) throw new Error(resolved.error);

  const report = buildSlotAdviceReport(loaded, slot);
  console.log(report);
  if (opts.note) console.log(`operator note: ${opts.note}`);

  if (!opts.send) {
    console.log("(pass --send to prompt the worker with this advice)");
    return { slot, report, sent: false };
  }

  const prefix = loaded.profile.daemon.managerPromptPrefix;
  const ports =
    resolved.row.ports || portsForSlot(loaded.profile.ports.worker, slot);
  let msg =
    `${prefix} slot-${slot} ports ${ports} - SLOT-ADVICE (from operator via manager): ` +
    "Review dc.sh / worktree conventions for your seat and fix if needed.\n\n" +
    report;
  if (opts.note) msg += `\n\noperator note: ${opts.note}`;
  msg +=
    `\n\nIf advice says RISK/WARN: correct the worktree (clone-feature-db / pairing / nested -D-R) ` +
    `before migrations or Redis experiments. Update slot-${slot} FOCUS.md (NOW) + TASKS.md if needed. ` +
    "See .agent/local-dev.md.";

  const resp = enqueuePeer(loaded, {
    kind: "prompt",
    msg,
    targetPane: resolved.paneId,
    targetLabel: `slot-${slot}`,
    fromSlot: "manager",
  });
  if (!resp?.ok) {
    throw new Error("FAIL: slot-advice enqueue (inbox down?) — run: ./sm.sh inbox restart");
  }
  console.log(`sent slot-advice -> slot-${slot} ${resolved.paneId} (daemon inject when idle)`);
  return { slot, report, sent: true };
}

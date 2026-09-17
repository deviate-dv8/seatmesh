import { randomUUID } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";

const AgentId = z.string().min(1);

export const AgentApplyInstructionSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
  assignTo: z.array(AgentId).optional(),
});

export const AgentApplySuperviseSchema = z.object({
  supervisor: AgentId,
  members: z.array(AgentId).min(1),
  interval: z.string().optional(),
});

export const AgentApplyBalanceSchema = z.object({
  balanceLead: AgentId,
  balancees: z.array(AgentId).min(1),
  mainLead: AgentId,
  interval: z.string().optional(),
});

export const AgentApplyTrafficDenySchema = z.object({
  denyInboundTo: AgentId,
  from: z.array(AgentId).min(1),
});

export const AgentApplyBundleSchema = z.object({
  mainLead: AgentId.default("manager"),
  supervise: z.array(AgentApplySuperviseSchema).default([]),
  balance: z.array(AgentApplyBalanceSchema).default([]),
  traffic: z.array(AgentApplyTrafficDenySchema).default([]),
  instructions: z.array(AgentApplyInstructionSchema).default([]),
});

export type AgentApplyBundle = z.infer<typeof AgentApplyBundleSchema>;

export interface ParseAgentApplyOptions {
  dryRun?: boolean;
  preflight?: boolean;
  assign?: boolean;
}

const CLAUSE_KEYWORDS = new Set([
  "supervise",
  "balance",
  "interval",
  "main",
  "no-inbound",
  "from",
  "--main",
]);

function parseMemberList(raw: string): string[] {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    return t
      .slice(1, -1)
      .split(/[,+]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return t.split(/[\s,]+/).filter(Boolean);
}

function isInstructionToken(word: string): boolean {
  return /^instruction\[\d+\]$/.test(word);
}

function isClauseBoundary(word: string): boolean {
  return (
    CLAUSE_KEYWORDS.has(word) ||
    isInstructionToken(word) ||
    word === "no-inbound"
  );
}

/** Next clause may be `<lead> supervise|balance …` (not slot/mini ids — those are usually members). */
function isLeadFirstClause(rest: string[], at: number): boolean {
  const lead = rest[at];
  const kind = rest[at + 1];
  if (!lead || !kind) return false;
  if (CLAUSE_KEYWORDS.has(lead) || isInstructionToken(lead) || lead === "--main") {
    return false;
  }
  if (/^(slot|mini)-\d+$/i.test(lead)) return false;
  return kind === "supervise" || kind === "balance";
}

function collectAgentList(rest: string[], start: number): { agents: string[]; next: number } {
  const agents: string[] = [];
  let i = start;
  while (i < rest.length) {
    const n = rest[i];
    if (!n || isClauseBoundary(n) || n === "--main") break;
    if (isLeadFirstClause(rest, i)) break;
    agents.push(...parseMemberList(n));
    i++;
  }
  return { agents, next: i };
}

function collectInstructionText(rest: string[], start: number): { text: string; next: number } {
  const parts: string[] = [];
  let i = start;
  while (i < rest.length) {
    const n = rest[i];
    if (!n || isClauseBoundary(n) || n === "--main") break;
    if (isLeadFirstClause(rest, i)) break;
    parts.push(n);
    i++;
  }
  const text = parts.join(" ").trim();
  return { text, next: i };
}

/** Parse `sm agent apply …` argv (after `apply`) into a bundle. */
export function parseAgentApplyArgs(args: string[]): {
  bundle: AgentApplyBundle;
  opts: ParseAgentApplyOptions;
} {
  const opts: ParseAgentApplyOptions = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--preflight") opts.preflight = true;
    else if (a === "--assign") opts.assign = true;
    else if (a === "--main" && args[i + 1]) {
      /* handled in bundle loop */
      rest.push(a, args[++i]);
    } else rest.push(a);
  }

  const bundle: AgentApplyBundle = {
    mainLead: "manager",
    supervise: [],
    balance: [],
    traffic: [],
    instructions: [],
  };

  let pendingInterval: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--main" && rest[i + 1]) {
      bundle.mainLead = rest[++i];
      continue;
    }
    if (word === "interval" && rest[i + 1]) {
      pendingInterval = rest[++i];
      continue;
    }
    if (word === "main" && rest[i + 1]) {
      bundle.mainLead = rest[++i];
      continue;
    }
    const instr = word.match(/^instruction\[(\d+)\]$/);
    if (instr) {
      const idx = Number(instr[1]);
      const { text, next } = collectInstructionText(rest, i + 1);
      if (!text) throw new Error(`instruction[${idx}] requires text`);
      bundle.instructions.push({ index: idx, text });
      i = next - 1;
      continue;
    }
    if (isLeadFirstClause(rest, i)) {
      const lead = word;
      const kind = rest[++i];
      if (kind === "supervise") {
        const { agents: members, next } = collectAgentList(rest, i + 1);
        i = next - 1;
        if (!members.length) throw new Error(`supervise ${lead} requires members`);
        bundle.supervise.push({
          supervisor: lead,
          members,
          interval: pendingInterval,
        });
        pendingInterval = undefined;
        continue;
      }
      if (kind === "balance") {
        const { agents: balancees, next } = collectAgentList(rest, i + 1);
        i = next - 1;
        if (!balancees.length) throw new Error(`balance ${lead} requires balancees`);
        bundle.balance.push({
          balanceLead: lead,
          balancees,
          mainLead: bundle.mainLead,
          interval: pendingInterval,
        });
        pendingInterval = undefined;
        continue;
      }
    }
    if (word === "supervise") {
      const supervisor = rest[++i];
      if (!supervisor) throw new Error("supervise requires supervisor agent id");
      const { agents: members, next } = collectAgentList(rest, i + 1);
      i = next - 1;
      if (!members.length) throw new Error(`supervise ${supervisor} requires members`);
      bundle.supervise.push({
        supervisor,
        members,
        interval: pendingInterval,
      });
      pendingInterval = undefined;
      continue;
    }
    if (word === "balance") {
      const balanceLead = rest[++i];
      if (!balanceLead) throw new Error("balance requires balance_lead agent id");
      const { agents: balancees, next } = collectAgentList(rest, i + 1);
      i = next - 1;
      if (!balancees.length) throw new Error(`balance ${balanceLead} requires balancees`);
      bundle.balance.push({
        balanceLead,
        balancees,
        mainLead: bundle.mainLead,
        interval: pendingInterval,
      });
      pendingInterval = undefined;
      continue;
    }
    if (word === "no-inbound") {
      const denyInboundTo = rest[++i];
      if (rest[++i] !== "from") throw new Error("no-inbound <agent> from <members…>");
      const { agents: from, next } = collectAgentList(rest, i + 1);
      i = next - 1;
      if (!denyInboundTo || !from.length) {
        throw new Error("no-inbound <agent> from <member> …");
      }
      bundle.traffic.push({ denyInboundTo, from });
      continue;
    }
    throw new Error(`unknown agent apply token: ${word}`);
  }

  return { bundle: AgentApplyBundleSchema.parse(bundle), opts };
}

export type PreflightLoad = "LOW" | "MED" | "HIGH";

export interface AgentApplyPreflightRow {
  agentId: string;
  existingLocks: string[];
  wouldAdd: string[];
  load: PreflightLoad;
}

/** Pure preflight from bundle + known lock ids (caller supplies listContractLocks rows). */
export function preflightAgentBundle(
  bundle: AgentApplyBundle,
  existingLocksByAgent: Map<string, string[]>,
): AgentApplyPreflightRow[] {
  const byAgent = new Map<string, Set<string>>();

  const add = (agent: string, what: string) => {
    if (!byAgent.has(agent)) byAgent.set(agent, new Set());
    byAgent.get(agent)!.add(what);
  };

  for (const s of bundle.supervise) {
    add(s.supervisor, `supervise(${s.members.join(",")})`);
    for (const m of s.members) add(m, `supervisee:${s.supervisor}`);
  }
  for (const b of bundle.balance) {
    add(b.balanceLead, `balance(${b.balancees.join(",")})`);
    for (const m of b.balancees) add(m, `balancee:${b.balanceLead}`);
  }

  const rows: AgentApplyPreflightRow[] = [];
  for (const [agentId, would] of byAgent) {
    const existing = existingLocksByAgent.get(agentId) ?? [];
    const wouldAdd = [...would];
    const total = existing.length + wouldAdd.length;
    let load: PreflightLoad = "LOW";
    if (total >= 3) load = "HIGH";
    else if (total >= 2) load = "MED";
    rows.push({ agentId, existingLocks: existing, wouldAdd, load });
  }
  return rows.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/** Resolved bundle document for `.sm/contracts/active/apply-*.yaml` (P0). */
export function agentApplyBundleDocument(
  bundle: AgentApplyBundle,
  id?: string,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: id ?? `apply-${randomUUID().slice(0, 8)}`,
    main_lead: bundle.mainLead,
    supervise: bundle.supervise.map((s) => ({
      supervisor: s.supervisor,
      members: s.members,
      ...(s.interval ? { interval: s.interval } : {}),
    })),
    balance: bundle.balance.map((b) => ({
      balance_lead: b.balanceLead,
      main_lead: b.mainLead,
      balancees: b.balancees,
      ...(b.interval ? { interval: b.interval } : {}),
    })),
    traffic: bundle.traffic.map((t) => ({
      deny_inbound_to: t.denyInboundTo,
      from: t.from,
    })),
    instructions: bundle.instructions.map((ins) => ({
      index: ins.index,
      text: ins.text,
      ...(ins.assignTo?.length ? { assign_to: ins.assignTo } : {}),
    })),
  };
  return doc;
}

export function serializeAgentApplyBundleYaml(
  bundle: AgentApplyBundle,
  id?: string,
): string {
  return YAML.stringify(agentApplyBundleDocument(bundle, id));
}

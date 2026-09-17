import path from "node:path";
import { z } from "zod";
import {
  AgentKindsMapSchema,
  launchCmdFromKind,
  lookupResolvedKind,
  type ResolvedAgentKind,
} from "./kinds.js";

const LAUNCH_PREFIX = "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor";

/** Profile runner entry: workspace-relative script or { command, sessionFlag }. */
export const AgentRunnerSchema = z.union([
  z.string().min(1),
  z.object({
    command: z.string().min(1),
    sessionFlag: z.string().optional(),
  }),
]);

export type AgentRunnerEntry = z.infer<typeof AgentRunnerSchema>;

export const AgentRunnersMapSchema = z.record(z.string(), AgentRunnerSchema);

export const AgentsConfigSchema = z
  .object({
    kinds: AgentKindsMapSchema.optional().default({}),
    runners: AgentRunnersMapSchema.optional().default({}),
  })
  .default({});

export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
/** Loose input for profile patches / tests (defaults applied at parse). */
export type AgentsConfigInput = z.input<typeof AgentsConfigSchema>;

const BUILTIN_KINDS = new Set(["agent", "claude", "kiro", "opencode", "empty"]);

/** Normalize switch/layout kind aliases (oc, cursor, …). */
export function normalizeAgentKind(raw: string): string {
  const x = raw.trim().toLowerCase().replace(/_/g, "-");
  if (x === "cursor-agent" || x === "cursor") return "agent";
  if (x === "cc") return "claude";
  if (x === "oc" || x === "opencode-main") return "opencode";
  if (x === "ocproxy") return "oc-proxy";
  return x;
}

export function isOpenCodeKind(kind: string): boolean {
  const k = normalizeAgentKind(kind);
  return k === "opencode" || k === "oc-proxy";
}

export function defaultOcProxyRunner(): string {
  return "scripts/opencode-cpe.sh";
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_./=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

function resolveRunnerScript(workspace: string, entry: AgentRunnerEntry): string {
  const cmd = typeof entry === "string" ? entry : entry.command;
  if (path.isAbsolute(cmd)) return cmd;
  return path.join(workspace, cmd.replace(/^\.\//, ""));
}

function sessionFlagFor(entry: AgentRunnerEntry): string {
  return typeof entry === "object" && entry.sessionFlag ? entry.sessionFlag : "--session";
}

function wrapScriptLaunch(
  workspace: string,
  script: string,
  resumeId: string | null | undefined,
  sessionFlag: string,
): string {
  // cd must run in the pane shell — `env … cd …` treats cd as a binary and fails.
  const run = resumeId
    ? `${shellQuote(script)} ${sessionFlag} ${resumeId}`
    : shellQuote(script);
  return `cd ${shellQuote(workspace)} && ${LAUNCH_PREFIX} ${run}`;
}

function ocProxyRunnerEntry(
  runners: Record<string, AgentRunnerEntry>,
): AgentRunnerEntry {
  return runners["oc-proxy"] ?? runners.opencode ?? defaultOcProxyRunner();
}

/**
 * Profile runner overrides. Returns `undefined` when the kind should use built-in logic.
 */
export function buildCustomKindLaunchCmd(
  kindRaw: string,
  workspace: string,
  resumeId?: string | null,
  runners: Record<string, AgentRunnerEntry> = {},
): string | null | undefined {
  const kind = normalizeAgentKind(kindRaw);
  if (!kind || kind === "empty") return null;

  if (kind === "oc-proxy") {
    const entry = ocProxyRunnerEntry(runners);
    return wrapScriptLaunch(
      workspace,
      resolveRunnerScript(workspace, entry),
      resumeId,
      sessionFlagFor(entry),
    );
  }

  if (BUILTIN_KINDS.has(kind)) return undefined;

  const entry = runners[kind];
  if (!entry) return undefined;

  return wrapScriptLaunch(
    workspace,
    resolveRunnerScript(workspace, entry),
    resumeId,
    sessionFlagFor(entry),
  );
}

/** Built-in launch lines (shared by tmux agent-builder). */
export function buildBuiltinLaunchCmd(
  kindRaw: string,
  workspace: string,
  resumeId?: string | null,
): string | null {
  const kind = normalizeAgentKind(kindRaw);
  if (!kind || kind === "empty") return null;

  switch (kind) {
    case "agent":
      return resumeId
        ? `${LAUNCH_PREFIX} agent --trust --approve-mcps --resume ${resumeId} --workspace ${workspace}`
        : `${LAUNCH_PREFIX} agent --trust --approve-mcps --workspace ${workspace}`;
    case "claude":
      return resumeId
        ? `${LAUNCH_PREFIX} claude --permission-mode auto --resume ${resumeId}`
        : `${LAUNCH_PREFIX} claude --permission-mode auto`;
    case "kiro":
      return resumeId
        ? `${LAUNCH_PREFIX} kiro-cli chat --resume-id ${resumeId} --trust-all-tools --model claude-opus-5`
        : `${LAUNCH_PREFIX} kiro-cli chat --trust-all-tools --model claude-opus-5`;
    case "opencode":
      return resumeId
        ? `${LAUNCH_PREFIX} opencode --auto --session ${resumeId}`
        : `${LAUNCH_PREFIX} opencode --auto`;
    default:
      return null;
  }
}

/** Resolve any agent kind → full pane launch one-liner. */
export function buildKindLaunchCmd(
  kindRaw: string,
  workspace: string,
  resumeId?: string | null,
  runners: Record<string, AgentRunnerEntry> = {},
  /** When set, prefer resolved kind launch (provider JSON + profile overlay). */
  kinds?: Record<string, ResolvedAgentKind>,
): string | null {
  if (kinds) {
    const resolved = lookupResolvedKind(kinds, kindRaw);
    if (resolved) return launchCmdFromKind(resolved, workspace, resumeId);
  }
  const custom = buildCustomKindLaunchCmd(kindRaw, workspace, resumeId, runners);
  if (custom !== undefined) return custom;
  return buildBuiltinLaunchCmd(kindRaw, workspace, resumeId);
}

/** Merge profile runners; `runners.opencode` aliases to oc-proxy when oc-proxy unset. */
export function runnersFromProfile(
  profile: { agents?: AgentsConfigInput } | undefined,
): Record<string, AgentRunnerEntry> {
  const raw = profile?.agents?.runners ?? {};
  const runners = { ...raw };
  if (runners.opencode && !runners["oc-proxy"]) {
    runners["oc-proxy"] = runners.opencode;
  }
  return runners;
}

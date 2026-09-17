import path from "node:path";
import { z } from "zod";

const LAUNCH_PREFIX = "env -u NO_COLOR -u FORCE_COLOR COLORTERM=truecolor";

/** Runner shim shape (mirrors agents.runners — avoid import cycle with runners.ts). */
export type KindRunnerEntry = string | { command: string; sessionFlag?: string };

/** Launch: builtin family name, script wrapper, or null (empty shell). */
export const AgentKindLaunchSchema = z.union([
  z.object({ builtin: z.string().min(1) }),
  z.object({
    command: z.string().min(1),
    sessionFlag: z.string().optional(),
  }),
  z.null(),
]);

export type AgentKindLaunch = z.infer<typeof AgentKindLaunchSchema>;

export const AgentKindProveSchema = z
  .object({
    /** Regex strings matched against pane cmdline / process tree. */
    cmdline: z.array(z.string()).optional(),
    /** Regex strings matched against saved resumeCmd. */
    resumeCmd: z.array(z.string()).optional(),
  })
  .optional();

export const AgentKindSatisfySchema = z
  .object({
    /** Live provider id that may satisfy this kind when prove matches. */
    whenProvider: z.string().optional(),
    requireProve: z.boolean().optional(),
  })
  .optional();

export const AgentKindRecoverySchema = z
  .object({
    onProxyUp: z.boolean().optional(),
    continueCopy: z.string().optional(),
  })
  .optional();

/**
 * One agent kind document (JSON). Map key is the kind id (`opencode`, `opencode-cpe`, …).
 * Extensions set `extends` and inherit provider/launch/prove from the parent chain.
 */
export const AgentKindDefSchema = z
  .object({
    extends: z.string().min(1).optional(),
    /** Inject/detect family id (AgentProvider.id). Inherited via extends. */
    provider: z.string().min(1).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    launch: AgentKindLaunchSchema.optional(),
    prove: AgentKindProveSchema,
    satisfy: AgentKindSatisfySchema,
    recovery: AgentKindRecoverySchema,
  })
  .passthrough();

export type AgentKindDef = z.infer<typeof AgentKindDefSchema>;

export const AgentKindsMapSchema = z.record(z.string(), AgentKindDefSchema);

/** Fully merged kind (extends flattened). */
export type ResolvedAgentKind = AgentKindDef & {
  id: string;
  provider: string;
};

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_./=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

function deepMergeKind(parent: AgentKindDef, child: AgentKindDef): AgentKindDef {
  return {
    ...parent,
    ...child,
    // Keep extends from child if set, else parent (needed for profile overlays)
    extends: child.extends ?? parent.extends,
    aliases: child.aliases ?? parent.aliases,
    launch: child.launch !== undefined ? child.launch : parent.launch,
    prove: child.prove
      ? {
          cmdline: child.prove.cmdline ?? parent.prove?.cmdline,
          resumeCmd: child.prove.resumeCmd ?? parent.prove?.resumeCmd,
        }
      : parent.prove,
    satisfy: child.satisfy
      ? {
          whenProvider: child.satisfy.whenProvider ?? parent.satisfy?.whenProvider,
          requireProve: child.satisfy.requireProve ?? parent.satisfy?.requireProve,
        }
      : parent.satisfy,
    recovery: child.recovery
      ? {
          onProxyUp: child.recovery.onProxyUp ?? parent.recovery?.onProxyUp,
          continueCopy: child.recovery.continueCopy ?? parent.recovery?.continueCopy,
        }
      : parent.recovery,
  };
}

function flattenKind(
  id: string,
  raw: Record<string, AgentKindDef>,
  stack: string[] = [],
): ResolvedAgentKind {
  if (stack.includes(id)) {
    throw new Error(`agent kind cycle: ${[...stack, id].join(" → ")}`);
  }
  const def = raw[id];
  if (!def) {
    throw new Error(`unknown agent kind: ${id}`);
  }
  if (def.extends) {
    const parent = flattenKind(def.extends, raw, [...stack, id]);
    const merged = deepMergeKind(parent, def);
    const provider = merged.provider ?? parent.provider;
    if (!provider) {
      throw new Error(`agent kind ${id}: no provider after extends ${def.extends}`);
    }
    return { ...merged, id, provider, extends: undefined };
  }
  if (!def.provider) {
    throw new Error(`agent kind ${id}: missing provider (or extends)`);
  }
  return { ...def, id, provider: def.provider, extends: undefined };
}

/** Apply legacy `agents.runners` onto kind launch.command overlays. */
export function applyRunnersShim(
  kinds: Record<string, AgentKindDef>,
  runners: Record<string, KindRunnerEntry>,
): Record<string, AgentKindDef> {
  const out: Record<string, AgentKindDef> = { ...kinds };
  for (const [key, entry] of Object.entries(runners)) {
    const command = typeof entry === "string" ? entry : entry.command;
    const sessionFlag =
      typeof entry === "object" && entry.sessionFlag ? entry.sessionFlag : undefined;
    const prev = out[key] ?? {};
    out[key] = {
      ...prev,
      launch: {
        command,
        ...(sessionFlag ? { sessionFlag } : {}),
      },
    };
  }
  // Compat: runners.opencode / runners["oc-proxy"] / runners.opencode-cpe → kinds.opencode-cpe.launch
  const legacyOcProxy = runners["oc-proxy" as string];
  const cpeSrc = runners["opencode-cpe"] ?? legacyOcProxy ?? runners.opencode;
  if (cpeSrc && out["opencode-cpe"]) {
    const command = typeof cpeSrc === "string" ? cpeSrc : cpeSrc.command;
    const sessionFlag =
      typeof cpeSrc === "object" && cpeSrc.sessionFlag ? cpeSrc.sessionFlag : undefined;
    out["opencode-cpe"] = {
      ...out["opencode-cpe"],
      launch: {
        command,
        ...(sessionFlag ? { sessionFlag } : {}),
      },
    };
  }
  return out;
}

/**
 * Merge provider-emitted kinds ⊎ profile.agents.kinds ⊎ runners shim, then flatten extends.
 */
export function resolveAgentKinds(input: {
  /** kindBase + kindExtensions from loaded providers */
  fromProviders?: Record<string, AgentKindDef>;
  /** profile.agents.kinds overlay */
  fromProfile?: Record<string, AgentKindDef>;
  /** legacy agents.runners */
  runners?: Record<string, KindRunnerEntry>;
}): Record<string, ResolvedAgentKind> {
  let raw: Record<string, AgentKindDef> = {
    ...(input.fromProviders ?? {}),
  };
  for (const [id, overlay] of Object.entries(input.fromProfile ?? {})) {
    raw[id] = raw[id] ? deepMergeKind(raw[id], overlay) : overlay;
  }
  if (input.runners && Object.keys(input.runners).length) {
    raw = applyRunnersShim(raw, input.runners);
  }

  const resolved: Record<string, ResolvedAgentKind> = {};
  for (const id of Object.keys(raw)) {
    const def = raw[id];
    // Overlay-only stubs without provider/extends wait for parent — skip incomplete
    if (!def.provider && !def.extends && !def.launch) continue;
    if (!def.provider && !def.extends) continue;
    resolved[id] = flattenKind(id, raw);
  }
  return resolved;
}

/** Kind ids + aliases for switch / completion. */
export function knownAgentKindIds(kinds: Record<string, ResolvedAgentKind>): Set<string> {
  const out = new Set<string>();
  for (const [id, def] of Object.entries(kinds)) {
    out.add(id);
    for (const a of def.aliases ?? []) out.add(a);
  }
  return out;
}

export function lookupResolvedKind(
  kinds: Record<string, ResolvedAgentKind>,
  kindRaw: string,
): ResolvedAgentKind | undefined {
  const raw = kindRaw.trim().toLowerCase().replace(/_/g, "-");
  if (kinds[raw]) return kinds[raw];
  for (const def of Object.values(kinds)) {
    if (def.aliases?.some((a) => a.toLowerCase() === raw)) return def;
  }
  return undefined;
}

function wrapScriptLaunch(
  workspace: string,
  script: string,
  resumeId: string | null | undefined,
  sessionFlag: string,
): string {
  const run = resumeId
    ? `${shellQuote(script)} ${sessionFlag} ${resumeId}`
    : shellQuote(script);
  return `cd ${shellQuote(workspace)} && ${LAUNCH_PREFIX} ${run}`;
}

function resolveRunnerScript(workspace: string, cmd: string): string {
  if (path.isAbsolute(cmd)) return cmd;
  return path.join(workspace, cmd.replace(/^\.\//, ""));
}

/** Builtin launch lines (same as runners.buildBuiltinLaunchCmd). */
export function builtinLaunchLine(
  builtin: string,
  workspace: string,
  resumeId?: string | null,
): string | null {
  switch (builtin) {
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
    case "empty":
      return null;
    default:
      return null;
  }
}

/** Build pane launch one-liner from a resolved kind. */
export function launchCmdFromKind(
  kind: ResolvedAgentKind,
  workspace: string,
  resumeId?: string | null,
): string | null {
  const launch = kind.launch;
  if (launch === null) return null;
  if (!launch) return builtinLaunchLine(kind.id === "agent" ? "agent" : kind.provider, workspace, resumeId);
  if ("builtin" in launch) {
    return builtinLaunchLine(launch.builtin, workspace, resumeId);
  }
  if ("command" in launch) {
    const sessionFlag = launch.sessionFlag ?? "--session";
    return wrapScriptLaunch(
      workspace,
      resolveRunnerScript(workspace, launch.command),
      resumeId,
      sessionFlag,
    );
  }
  return null;
}

/** Pull kinds + runners maps from profile.agents (partial). */
export function kindsMapsFromAgentsConfig(agents: {
  kinds?: Record<string, AgentKindDef>;
  runners?: Record<string, KindRunnerEntry>;
} | undefined): {
  fromProfile: Record<string, AgentKindDef>;
  runners: Record<string, KindRunnerEntry>;
} {
  return {
    fromProfile: agents?.kinds ?? {},
    runners: agents?.runners ?? {},
  };
}

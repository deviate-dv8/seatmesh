import type {
  AgentProvider,
  ComposerState,
  LimitContext,
  LimitDetector,
  LimitJob,
  PaneSnapshot,
  UxConfig,
} from "seat-mesh-core";
import {
  evaluateUxRules,
  resolveUxConfig,
  type ResolvedUxConfig,
  type UxTrigger,
} from "seat-mesh-core";

function triggerToJobType(trigger: UxTrigger): string {
  switch (trigger) {
    case "connectivity.rate-limit":
      return "limits.oc-limit";
    case "connectivity.proxy-down":
      return "connectivity.proxy-up";
    case "limits.oc-limit":
      return "limits.oc-limit";
    case "limits.cc-limit":
      return "limits.cc-limit";
    default:
      return "none";
  }
}

function limitDetectorsForProvider(
  config: ResolvedUxConfig,
  providerId: string,
): LimitDetector[] {
  const out: LimitDetector[] = [];
  for (const rule of config.rules) {
    if (!rule.onRise || rule.onRise === "none") continue;
    if (rule.set.phase !== "limit" || !rule.set.kind) continue;
    if (!rule.for.includes("*") && !rule.for.includes(providerId)) continue;

    const kind = rule.set.kind;
    const trigger = rule.onRise;
    out.push({
      id: rule.id,
      match(state: ComposerState) {
        return state.phase === "limit" && state.limitKind === kind;
      },
      async onRisingEdge(ctx: LimitContext) {
        const jobType = triggerToJobType(trigger);
        if (jobType === "none") return;
        const job: LimitJob = {
          type: jobType,
          paneId: ctx.pane.paneId,
          payload: { ruleId: rule.id, providerId: ctx.providerId, limitKind: kind },
        };
        if (trigger === "connectivity.rate-limit") {
          job.payload = { ...job.payload, wave: "all-oc-panes" };
        }
        await ctx.enqueue(job);
      },
    });
  }
  return out;
}

/** Config-driven composerState + limit detectors (replaces hardcoded provider limits). */
export function wrapProviderWithUx(
  provider: AgentProvider,
  config: ResolvedUxConfig,
): AgentProvider {
  const limits = limitDetectorsForProvider(config, provider.id);
  return {
    ...provider,
    composerState(pane: PaneSnapshot): ComposerState {
      return evaluateUxRules(pane, provider.id, config)?.state ?? { phase: "empty" };
    },
    limits: limits.length > 0 ? limits : provider.limits,
  };
}

export function wrapRegistryProviders(
  providers: AgentProvider[],
  ux?: UxConfig,
): AgentProvider[] {
  if (ux === undefined) return providers;
  const config = resolveUxConfig(ux);
  return providers.map((p) => wrapProviderWithUx(p, config));
}

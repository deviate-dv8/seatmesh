import {
  createProviderRegistry,
  kindsMapsFromAgentsConfig,
  normalizeAgentKind,
  resolveAgentKinds,
  resolveUxConfig,
  type AgentKindDef,
  type AgentProvider,
  type MeshProfile,
  type ProviderRegistry,
  type ResolvedAgentKind,
  type UxConfig,
} from "@seat-mesh/core";
import { cursorAgentProvider } from "./cursor-agent.js";
import { kiroProvider } from "./kiro.js";
import { claudeProvider } from "./claude.js";
import { opencodeProvider } from "./opencode.js";
import { emptyProvider } from "./empty.js";
import { wrapProviderWithUx } from "./ux-wrap.js";

const BUILTIN = [
  cursorAgentProvider,
  kiroProvider,
  claudeProvider,
  opencodeProvider,
  emptyProvider,
];

/**
 * Map profile `providers:` entries (CliType aliases + future kinds) → builtin
 * AgentProvider ids used for detect/inject.
 */
export function normalizeProviderEnableIds(raw: string[] | undefined): string[] | undefined {
  if (!raw?.length) return undefined;
  const out = new Set<string>();
  for (const entry of raw) {
    const k = normalizeAgentKind(entry);
    if (k === "oc-proxy" || k === "opencode") {
      out.add("opencode");
      continue;
    }
    if (k === "agent") {
      out.add("cursor-agent");
      continue;
    }
    if (k === "claude" || k === "kiro" || k === "empty") {
      out.add(k);
      continue;
    }
    // Unknown kind (kimi, …): keep raw + normalized so a future provider can match.
    out.add(entry.trim());
    if (k !== entry.trim()) out.add(k);
  }
  return [...out];
}

/** Collect kindBase + kindExtensions from provider classes into a kinds map. */
export function collectProviderKinds(
  providers: AgentProvider[] = BUILTIN,
): Record<string, AgentKindDef> {
  const out: Record<string, AgentKindDef> = {};
  for (const p of providers) {
    if (p.kindBase) {
      const base = p.kindBase();
      // Seat harness id for cursor family is `agent` (switch/layout); provider id stays cursor-agent
      const kindId = p.id === "cursor-agent" ? "agent" : p.id;
      out[kindId] = {
        ...base,
        provider: base.provider ?? p.id,
      };
    }
    for (const ext of p.kindExtensions?.() ?? []) {
      const { id, ...rest } = ext;
      out[id] = rest;
    }
  }
  return out;
}

/** Provider-emitted kinds ⊎ profile.agents.kinds ⊎ runners shim. */
export function resolveKindsForProfile(
  profile: Pick<MeshProfile, "agents" | "providers">,
): Record<string, ResolvedAgentKind> {
  const enabled = normalizeProviderEnableIds(profile.providers);
  const allow = enabled ? new Set(enabled) : null;
  const providers = allow ? BUILTIN.filter((p) => allow.has(p.id)) : [...BUILTIN];
  if (!providers.some((p) => p.id === "empty")) {
    providers.push(emptyProvider);
  }
  const fromProviders = collectProviderKinds(providers);
  const { fromProfile, runners } = kindsMapsFromAgentsConfig(profile.agents);
  return resolveAgentKinds({ fromProviders, fromProfile, runners });
}

export function createBuiltinRegistry(
  enabledIds?: string[],
  ux?: UxConfig,
): ProviderRegistry {
  const reg = createProviderRegistry();
  const normalized = normalizeProviderEnableIds(enabledIds);
  const allow = normalized ? new Set(normalized) : null;
  const uxConfig = ux !== undefined ? resolveUxConfig(ux) : null;
  for (const p of BUILTIN) {
    if (allow && !allow.has(p.id)) continue;
    reg.register(uxConfig ? wrapProviderWithUx(p, uxConfig) : p);
  }
  return reg;
}

/** Registry with optional profile ux rules (border status + limit triggers). */
export function createRegistryForProfile(
  profile: Pick<MeshProfile, "providers" | "ux">,
): ProviderRegistry {
  return createBuiltinRegistry(profile.providers, profile.ux);
}

export {
  cursorAgentProvider,
  kiroProvider,
  claudeProvider,
  opencodeProvider,
  emptyProvider,
};

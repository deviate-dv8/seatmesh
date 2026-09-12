import {
  createProviderRegistry,
  resolveUxConfig,
  type MeshProfile,
  type ProviderRegistry,
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

export function createBuiltinRegistry(
  enabledIds?: string[],
  ux?: UxConfig,
): ProviderRegistry {
  const reg = createProviderRegistry();
  const allow = enabledIds ? new Set(enabledIds) : null;
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

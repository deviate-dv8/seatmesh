/**
 * `.sm/providers/*.mjs` drop-in provider loader (TODO 6.1a — see
 * docs/HANDOUT-PROVIDERS-DROPIN.md for the full design). Phase 1: loader +
 * validation + error-isolation wrapper only. NOT wired into any registry yet
 * (6.1b) — this module is a pure, unit-testable function over a directory.
 *
 * `.mjs` specifically, not `.js`: a consumer project's own package.json "type"
 * field is not guaranteed to be "module", and `.mjs` is unambiguous regardless.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentProvider,
  ComposerState,
  InjectPlan,
} from "@seat-mesh/core";

export type DropInLogger = (line: string) => void;

export interface DropInSkip {
  file: string;
  reason: string;
}

export interface DropInLoadResult {
  providers: AgentProvider[];
  skipped: DropInSkip[];
}

const REQUIRED_METHODS = [
  "detect",
  "composerState",
  "composerReady",
  "injectPlan",
  "sessionId",
  "modelId",
  "scrapePromptTurn",
] as const;

/** Duck-type check against the AgentProvider contract — no schema library needed for a shape this small. */
export function isValidDropInProvider(candidate: unknown): candidate is AgentProvider {
  if (!candidate || typeof candidate !== "object") return false;
  const p = candidate as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id.trim()) return false;
  for (const method of REQUIRED_METHODS) {
    if (typeof p[method] !== "function") return false;
  }
  return true;
}

const FALLBACK_COMPOSER_STATE: ComposerState = { phase: "plain_shell" };
const FALLBACK_INJECT_PLAN: InjectPlan = {
  prefix: "",
  useBracketedPaste: false,
  enterDelayMs: 0,
  flushEscFirst: false,
};

const WARN_THROTTLE_MS = 60_000;

/** Per-(provider, method) throttle so a provider throwing every scan tick doesn't spam the log. */
function createThrottledWarn(log: DropInLogger): (key: string, msg: string) => void {
  const lastAt = new Map<string, number>();
  return (key: string, msg: string) => {
    const now = Date.now();
    const last = lastAt.get(key) ?? 0;
    if (now - last < WARN_THROTTLE_MS) return;
    lastAt.set(key, now);
    log(msg);
  };
}

/**
 * A throwing or misbehaving method returns a safe "nothing detected / idle"
 * fallback instead of propagating — called on every pane scan tick, so this
 * wrapper (not the many scattered call sites) is the one place that has to hold.
 * Does NOT protect against a synchronous infinite loop — see the design doc.
 */
export function wrapDropInProvider(provider: AgentProvider, log: DropInLogger): AgentProvider {
  const warn = createThrottledWarn(log);
  const guard = <Args extends unknown[], R>(
    method: string,
    fn: ((...args: Args) => R) | undefined,
    fallback: R,
  ): ((...args: Args) => R) | undefined => {
    if (!fn) return undefined;
    return (...args: Args): R => {
      try {
        return fn.apply(provider, args);
      } catch (e) {
        warn(
          `${provider.id}:${method}`,
          `drop-in provider ${provider.id}.${method} threw: ${(e as Error).message} — using fallback`,
        );
        return fallback;
      }
    };
  };

  return {
    ...provider,
    detect: guard("detect", provider.detect, null)!,
    composerState: guard("composerState", provider.composerState, FALLBACK_COMPOSER_STATE)!,
    composerReady: guard("composerReady", provider.composerReady, false)!,
    injectPlan: guard("injectPlan", provider.injectPlan, FALLBACK_INJECT_PLAN)!,
    sessionId: guard("sessionId", provider.sessionId, undefined)!,
    modelId: guard("modelId", provider.modelId, undefined)!,
    scrapePromptTurn: guard("scrapePromptTurn", provider.scrapePromptTurn, null)!,
    humanDraft: guard("humanDraft", provider.humanDraft, ""),
  };
}

/**
 * Load + validate + wrap every `*.mjs` in `dir`. Never throws — a missing dir,
 * an unreadable dir, a syntax error in one file, or an invalid export all result
 * in that file being skipped (logged), not the whole load failing. Fail open.
 */
export async function loadDropInProviders(
  dir: string,
  log: DropInLogger = () => {},
): Promise<DropInLoadResult> {
  const providers: AgentProvider[] = [];
  const skipped: DropInSkip[] = [];
  if (!fs.existsSync(dir)) return { providers, skipped };

  let files: string[];
  try {
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".mjs"))
      .map((d) => d.name)
      .sort();
  } catch (e) {
    log(`drop-in providers: cannot read ${dir}: ${(e as Error).message}`);
    return { providers, skipped };
  }

  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const mod = (await import(pathToFileURL(full).href)) as { default?: unknown };
      if (!isValidDropInProvider(mod.default)) {
        skipped.push({ file, reason: "default export does not match AgentProvider" });
        log(`drop-in provider ${file}: skipped (invalid shape — see docs/HANDOUT-PROVIDERS-DROPIN.md)`);
        continue;
      }
      const wrapped = wrapDropInProvider(mod.default, log);
      providers.push(wrapped);
      log(`drop-in provider ${file}: loaded id=${wrapped.id}`);
    } catch (e) {
      const reason = (e as Error).message;
      skipped.push({ file, reason });
      log(`drop-in provider ${file}: skipped (import failed: ${reason})`);
    }
  }

  return { providers, skipped };
}

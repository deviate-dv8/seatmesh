import { stripMeshOwnedLines } from "../messages/mesh-copy.js";
import type { ComposerState, PaneSnapshot } from "../providers/types.js";
import {
  UxSchema,
  type UxConfig,
  type UxRule,
  type UxWhen,
} from "../schema/ux.js";
import { DEFAULT_UX_RULES } from "./defaults.js";

export interface UxMatchResult {
  ruleId: string;
  state: ComposerState;
  border?: string;
  onRise?: string;
}

export interface ResolvedUxConfig {
  rules: UxRule[];
}

function bottomNonEmptyLines(text: string, n: number): string {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .join("\n");
}

function scanText(tail: string, when: UxWhen): string {
  const scan = when.scan ?? { tailLines: 28 };
  if (scan.full) return tail;
  if (scan.bottomLines != null) return bottomNonEmptyLines(tail, scan.bottomLines);
  const lines = scan.tailLines ?? 28;
  return tail.split("\n").slice(-lines).join("\n");
}

function testWhen(text: string, when: UxWhen): RegExpMatchArray | null {
  if (!text.trim() && when.scan?.full !== true) {
    if (when.match === "^\\s*$") return [""];
    return null;
  }
  const re = new RegExp(when.match, "im");
  const m = text.match(re);
  if (!m) return null;
  if (when.unless && new RegExp(when.unless, "im").test(text)) return null;
  return m;
}

function expandBorder(template: string | undefined, kind?: string, busyLabel?: string): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{kind\}/g, kind ?? busyLabel ?? "busy");
}

function ruleApplies(rule: UxRule, providerId: string): boolean {
  if (rule.for.includes("*")) return true;
  return rule.for.includes(providerId);
}

/** OpenCode: composer prompt visible but not busy -> empty (overrides stale limit lines). */
function opencodeComposerOverride(
  tail: string,
  providerId: string,
): ComposerState | null {
  if (providerId !== "opencode") return null;
  const bottomLines = tail.split("\n").filter((l) => l.trim()).slice(-8);
  const bottom = bottomLines.join("\n");
  const atComposer =
    /ctrl\+p commands/i.test(bottom) ||
    /Ask anything|Ask a question|Type a message|Send a message|What would you like/i.test(
      bottom,
    );
  if (!atComposer) return null;
  const recentBusy =
    /⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|esc interrupt/i.test(bottom) ||
    bottomLines.slice(-3).some((l) => /^(Working|Running|Thinking)\b/.test(l.trim()));
  if (recentBusy) return null;
  return { phase: "empty" };
}

/** Cursor idle post-turn chrome (follow-up box + composer footer) is deliverable — not active generate. */
function cursorAgentIdleOverride(
  tail: string,
  providerId: string,
): ComposerState | null {
  if (providerId !== "cursor-agent" && providerId !== "agent") return null;
  const bottom = tail.split("\n").slice(-14).join("\n");
  if (/Working|Running|Thinking|enter steer|ctrl\+c to stop/i.test(bottom)) {
    return null;
  }
  if (/Add a follow-up|Composer \d|· \d+\.\d+%|files edited/.test(bottom)) {
    return { phase: "empty" };
  }
  return null;
}

function statusFromRule(rule: UxRule, m: RegExpMatchArray): UxMatchResult {
  const { set } = rule;
  let kind = set.kind;
  let busyLabel = set.busyLabel;
  if (set.capture != null && m[set.capture]) {
    const cap = m[set.capture]!.trim();
    if (set.phase === "limit") kind = cap;
    else if (set.phase === "busy") busyLabel = cap;
  }
  if (set.phase === "busy" && !busyLabel && kind) busyLabel = kind;
  if (set.phase === "busy" && busyLabel && !kind) kind = busyLabel;

  const state: ComposerState = { phase: set.phase };
  if (set.phase === "limit" && kind) state.limitKind = kind;
  if (set.phase === "busy") state.busyLabel = busyLabel ?? kind ?? "busy";
  if (set.phase === "typing" && m[1]) {
    state.draftFingerprint = m[1].trim().slice(0, 80);
  }

  return {
    ruleId: rule.id,
    state,
    border: expandBorder(set.border, kind, busyLabel),
    onRise: rule.onRise,
  };
}

export function resolveUxConfig(raw: UxConfig | undefined): ResolvedUxConfig {
  const parsed = raw ? UxSchema.parse(raw) : UxSchema.parse({});
  const byId = new Map<string, UxRule>();
  if (parsed.useDefaults) {
    for (const r of DEFAULT_UX_RULES) byId.set(r.id, r);
  }
  for (const r of parsed.rules) byId.set(r.id, r);
  const rules = [...byId.values()].sort((a, b) => b.priority - a.priority);
  return { rules };
}

export function evaluateUxRules(
  pane: PaneSnapshot,
  providerId: string,
  config: ResolvedUxConfig,
): UxMatchResult | null {
  const tail = stripMeshOwnedLines(pane.captureTail);
  if (!tail.trim()) {
    return {
      ruleId: "plain-empty",
      state: { phase: "plain_shell" },
      border: "empty",
    };
  }

  const ocOverride = opencodeComposerOverride(tail, providerId);
  if (ocOverride) {
    return { ruleId: "oc-composer-idle", state: ocOverride, border: "idle" };
  }

  const cursorIdle = cursorAgentIdleOverride(tail, providerId);
  if (cursorIdle) {
    return { ruleId: "cursor-idle-chrome", state: cursorIdle, border: "idle" };
  }

  for (const rule of config.rules) {
    if (!ruleApplies(rule, providerId)) continue;
    const text = scanText(tail, rule.when);
    const m = testWhen(text, rule.when);
    if (!m) continue;
    return statusFromRule(rule, m);
  }

  return { ruleId: "idle", state: { phase: "empty" }, border: "idle" };
}

export function uxComposerState(
  pane: PaneSnapshot,
  providerId: string,
  config: ResolvedUxConfig | undefined,
): ComposerState {
  if (!config || config.rules.length === 0) {
    return { phase: "empty" };
  }
  return evaluateUxRules(pane, providerId, config)?.state ?? { phase: "empty" };
}

/** Classify limit kinds for connectivity recovery from ux triggers. */
export function uxLimitKinds(config: ResolvedUxConfig): {
  proxyDownKinds: Set<string>;
  rateLimitKinds: Set<string>;
  limitProviders: Set<string>;
} {
  const proxyDownKinds = new Set<string>();
  const rateLimitKinds = new Set<string>();
  const limitProviders = new Set<string>();

  for (const rule of config.rules) {
    if (rule.set.phase !== "limit" || !rule.set.kind) continue;
    if (rule.onRise === "connectivity.proxy-down") {
      proxyDownKinds.add(rule.set.kind);
      for (const p of rule.for) limitProviders.add(p);
    }
    if (rule.onRise === "connectivity.rate-limit") {
      rateLimitKinds.add(rule.set.kind);
      for (const p of rule.for) {
        if (p !== "*") limitProviders.add(p);
      }
    }
  }

  if (limitProviders.size === 0) {
    limitProviders.add("opencode");
    proxyDownKinds.add("oc-connect");
    rateLimitKinds.add("oc-limit");
  }

  return { proxyDownKinds, rateLimitKinds, limitProviders };
}

export function providerMonitoredForLimits(
  providerId: string,
  limitProviders: Set<string>,
): boolean {
  return limitProviders.has("*") || limitProviders.has(providerId);
}

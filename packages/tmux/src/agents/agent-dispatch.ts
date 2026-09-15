/**
 * Agent command gateway — panes run `seatmesh agent <cmd> …`.
 * patterns.md: one command surface; zero "which form do I use" decisions.
 * Unknown or role-denied → UNAUTHORIZED (exit 2). Operator/shared stay top-level.
 */
import { guardAllows, type CommsAction, type LoadedProfile, type SlotRole } from "@seat-mesh/core";
import { resolveGuardRole } from "./agent-card.js";
import { runWhoami, type WhoamiResult } from "./whoami.js";

/** Meta under `agent` itself — not dispatched as another CLI verb. */
export const AGENT_META = new Set(["apply", "preflight", "context"]);

/**
 * Operator / session shared — humans + lead ops run these *without* `agent`.
 * Calling `agent <verb>` for these is UNAUTHORIZED (keeps the gateway honest).
 */
export const OPERATOR_OUTSIDE_AGENT = new Set([
  "start",
  "init",
  "sessions",
  "update",
  "version",
  "migrate-runtime",
  "report",
  "test",
  "session",
  "layout",
  "realign",
  "ops",
  "save",
  "auto",
  "stack",
  "profile",
  "proxy",
  "providers",
  "manager",
  "index",
  "help",
  "target",
  "targets",
]);

/** Every in-pane seat may run these through the gateway. */
const SHARED_AGENT_VERBS = new Set([
  "whoami",
  "where",
  "ack",
  "cb",
  "checkback",
  "patience",
  "room",
  "chat",
  "contexts",
  "seats",
  "peek",
  "kind",
  "what",
  "typeof",
  "inbox",
  "pane-meta",
  "ppa",
  "cold-start",
  "coldstart",
  "seat",
  "notify",
  "preview",
]);

/** Verb → guard action (when not in SHARED). */
const VERB_ACTION: Record<string, CommsAction> = {
  peer: "send.peer",
  "to-slot": "send.peer",
  "to-mini": "send.peer",
  "to-master": "send.toMaster",
  assign: "prompt.worker",
  prompt: "prompt.worker",
  remind: "prompt.worker",
  flush: "prompt.worker",
  continue: "prompt.worker",
  night: "prompt.worker",
  "slot-advice": "prompt.worker",
  switch: "prompt.worker",
  handoff: "prompt.worker",
  set: "prompt.worker",
  tag: "prompt.worker",
  title: "prompt.worker",
  status: "prompt.worker",
  launch: "prompt.worker",
  mini: "spawn.mini",
  secretary: "send.coord",
  coord: "send.coord",
  balance: "send.coord",
  triage: "send.coord",
  verify: "send.coord",
  reload: "send.coord",
  labels: "send.coord",
  snapshot: "snapshot.cold",
  func: "nav.log",
};

/** Role extras that bypass CommsAction (card ROLE_EXTRA_CAN). */
const ROLE_EXTRA_VERBS: Record<SlotRole, Set<string>> = {
  manager: new Set([
    "triage",
    "secretary",
    "inbox",
    "launch",
    "verify",
    "reload",
    "labels",
    "assign",
    "prompt",
    "remind",
    "flush",
    "continue",
    "night",
    "switch",
    "handoff",
    "set",
    "tag",
    "title",
    "status",
    "mini",
    "coord",
    "balance",
    "slot-advice",
    "peer",
    "to-slot",
    "to-mini",
    "limit",
  ]),
  secretary: new Set([
    "secretary",
    "mini",
    "peer",
    "to-slot",
    "to-mini",
    "to-master",
    "assign", // digest / limited — deeper gates still apply
    "inbox",
    "limit",
  ]),
  worker: new Set(["peer", "to-slot", "to-mini", "to-master"]),
  mini: new Set(["peer", "to-slot", "to-mini", "mini"]),
  plain: new Set(),
};

export type AgentDispatchDecision =
  | { kind: "allow"; verb: string }
  | { kind: "card-target"; target: string }
  | { kind: "deny"; verb: string; youAre: string; guardRole: SlotRole }
  | { kind: "unknown"; verb: string; youAre: string }
  | { kind: "operator"; verb: string };

function looksLikeCardTarget(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t || t.startsWith("-")) return false;
  if (t === "here" || t === "self") return true;
  if (t.startsWith("%")) return true;
  if (/^slot-[1-9]\d*$/i.test(t)) return true;
  if (/^(?:mini|manager-mini)-[1-9]\d*$/i.test(t)) return true;
  if (/^[1-9]\d*$/.test(t)) return true;
  // column ids / roles used as whoami targets
  if (
    /^(manager|secretary|worker|plain)(-[a-z0-9]+)?$/i.test(t) ||
    t === "manager-b"
  ) {
    return true;
  }
  return false;
}

function roleAllowsVerb(guardRole: SlotRole, verb: string): boolean {
  if (SHARED_AGENT_VERBS.has(verb)) return true;
  if (ROLE_EXTRA_VERBS[guardRole]?.has(verb)) return true;
  const action = VERB_ACTION[verb];
  if (!action) return false;
  // send.coord peers: managers/secretaries use peer via ROLE_EXTRA; workers via send.peer
  if (verb === "peer") {
    return (
      guardAllows(guardRole, "send.peer") ||
      guardAllows(guardRole, "send.coord") ||
      ROLE_EXTRA_VERBS[guardRole]?.has("peer") === true
    );
  }
  return guardAllows(guardRole, action);
}

/** All verbs the gateway knows (allow or deny — never "unknown"). */
export function knownAgentVerbs(): Set<string> {
  return new Set([
    ...SHARED_AGENT_VERBS,
    ...Object.keys(VERB_ACTION),
    ...Object.values(ROLE_EXTRA_VERBS).flatMap((s) => [...s]),
  ]);
}

export function decideAgentDispatch(
  w: WhoamiResult,
  sub: string | undefined,
  tail: string[],
): AgentDispatchDecision {
  if (!sub) {
    return { kind: "card-target", target: "here" };
  }
  const verb = sub.trim().toLowerCase();
  if (AGENT_META.has(verb)) {
    // Caller handles meta before decide — should not reach here.
    return { kind: "allow", verb };
  }
  if (OPERATOR_OUTSIDE_AGENT.has(verb)) {
    return { kind: "operator", verb };
  }

  const { guardRole } = resolveGuardRole(w);
  const known = knownAgentVerbs();

  // Compat: `agent secretary` / `agent slot-1` with no args → card (not dispatch).
  // `agent secretary status` has args → gateway dispatch.
  if (!tail.length && looksLikeCardTarget(sub) && verb !== "whoami") {
    return { kind: "card-target", target: sub };
  }

  if (known.has(verb)) {
    if (roleAllowsVerb(guardRole, verb)) {
      return { kind: "allow", verb };
    }
    return {
      kind: "deny",
      verb,
      youAre: w.role || "plain",
      guardRole,
    };
  }

  return { kind: "unknown", verb, youAre: w.role || "plain" };
}

export function printAgentUnauthorized(
  decision: Extract<AgentDispatchDecision, { kind: "deny" | "unknown" | "operator" }>,
): void {
  if (decision.kind === "operator") {
    console.error(
      `UNAUTHORIZED: ${decision.verb} is operator/shared — run without agent: seatmesh ${decision.verb} …`,
    );
  } else if (decision.kind === "unknown") {
    console.error(
      `UNAUTHORIZED: unknown agent command '${decision.verb}' (you_are=${decision.youAre})`,
    );
  } else {
    console.error(
      `UNAUTHORIZED: agent ${decision.verb} denied for role=${decision.guardRole} (you_are=${decision.youAre})`,
    );
  }
  console.error("hint: seatmesh agent");
}

/** Strip the first bare `agent` token from argv (after node + script), keep --profile. */
export function stripAgentFromArgv(argv: string[]): string[] {
  const out = argv.slice();
  let i = 2;
  while (i < out.length) {
    const a = out[i]!;
    if (a === "--profile" || a === "-p") {
      i += 2;
      continue;
    }
    if (a.startsWith("--profile=")) {
      i += 1;
      continue;
    }
    if (a === "agent") {
      out.splice(i, 1);
      return out;
    }
    break;
  }
  return out;
}

export function assertAgentDispatch(
  loaded: LoadedProfile,
  sub: string | undefined,
  tail: string[],
): AgentDispatchDecision {
  const w = runWhoami(loaded, "here");
  return decideAgentDispatch(w, sub, tail);
}

import type { UxRule } from "../schema/ux.js";

/** Harness-parity defaults when profile.ux.useDefaults is true. */
export const DEFAULT_UX_RULES: UxRule[] = [
  {
    id: "plain-empty",
    for: ["*"],
    priority: 5,
    when: { scan: { full: true }, match: "^\\s*$" },
    set: { phase: "plain_shell" },
  },
  {
    id: "oc-composer-idle",
    for: ["opencode"],
    priority: 95,
    when: {
      scan: { bottomLines: 8 },
      match: "ctrl\\+p commands|Ask anything|Ask a question|Type a message|Send a message|What would you like",
    },
    set: { phase: "empty" },
  },
  {
    id: "oc-connect",
    for: ["opencode"],
    priority: 90,
    when: {
      scan: { tailLines: 28 },
      match:
        "cannot\\s+connect\\s+to\\s+api|unable\\s+to\\s+connect|service\\s+unavailable|connection\\s+error|ECONNREFUSED|socket\\s+connection\\s+was\\s+closed",
      unless:
        "rate\\s*limit|usage\\s*limit|quota\\s*exceed|hit your.*limit|limit reached|too many requests|429",
    },
    set: { phase: "limit", kind: "oc-connect", border: "PROXY-DOWN" },
    onRise: "connectivity.proxy-down",
  },
  {
    id: "oc-credit",
    for: ["opencode"],
    priority: 88,
    when: {
      scan: { tailLines: 28 },
      match:
        "insufficient_user_quota|out of credits|needs\\s*\\$[\\d.]+|orcarouter\\.ai/console/billing|err_credit_gate|Add credits to keep going",
    },
    set: { phase: "limit", kind: "oc-credit", border: "OC-CREDIT:oc-credit" },
    onRise: "none",
  },
  {
    id: "oc-limit",
    for: ["opencode"],
    priority: 85,
    when: {
      scan: { tailLines: 28 },
      match:
        "rate\\s*limit|usage\\s*limit|quota\\s*exceed|hit your.*limit|limit reached|too many requests|429|free[ -]?tier.*limit|plan limit|zen.*limit|session\\s*(expired|limit|ended)|expired\\s*session|provider\\s*limit|free\\s*usage\\s*exceed|usage\\s*exceeded|subscribe to go",
    },
    set: { phase: "limit", kind: "oc-limit", border: "OC-LIMIT:oc-limit" },
    onRise: "connectivity.rate-limit",
  },
  {
    id: "cc-limit",
    for: ["claude"],
    priority: 84,
    when: {
      scan: { tailLines: 16 },
      match: "rate limit|usage limit|try again later|quota exceeded",
    },
    set: { phase: "limit", kind: "cc-limit", border: "CC-LIMIT" },
    onRise: "limits.cc-limit",
  },
  {
    id: "cursor-usage-limit",
    for: ["cursor-agent"],
    priority: 86,
    when: {
      scan: { bottomLines: 14 },
      match: "out of usage|Increase limits for faster responses",
    },
    set: { phase: "limit", kind: "cursor-usage-limit", border: "CURSOR-LIMIT" },
    onRise: "none",
  },
  {
    id: "kiro-limit",
    for: ["kiro"],
    priority: 86,
    when: {
      scan: { tailLines: 20 },
      match:
        "monthly\\s+usage\\s+limit\\s+has\\s+been\\s+reached|usage\\s+limit\\s+has\\s+been\\s+reached|you(?:'ve| have)\\s+reached\\s+(?:your\\s+)?(?:monthly\\s+)?usage\\s+limit|request_id:\\s*[0-9a-fA-F-]{8,}",
    },
    set: { phase: "limit", kind: "kiro-limit", border: "KIRO-LIMIT" },
    onRise: "none",
  },
  {
    id: "cursor-generating",
    for: ["cursor-agent"],
    priority: 70,
    when: {
      scan: { bottomLines: 14 },
      match: "(Working|Running|Thinking)|ctrl\\+c to stop",
    },
    set: { phase: "busy", capture: 1, busyLabel: "BUSY", border: "{kind}" },
  },
  {
    id: "busy-generic",
    for: ["*"],
    priority: 60,
    when: { scan: { tailLines: 8 }, match: "(Working|Running|Thinking[^\\n]*)" },
    set: { phase: "busy", capture: 1, border: "{kind}" },
  },
  {
    id: "afk",
    for: ["*"],
    priority: 55,
    when: { scan: { tailLines: 12 }, match: "AFK|Stuck|draft" },
    set: { phase: "afk", border: "AFK" },
  },
  {
    id: "typing-prompt",
    for: ["*"],
    priority: 50,
    when: { scan: { full: true }, match: "^[❯›>](.+)" },
    set: { phase: "typing" },
  },
  {
    id: "idle",
    for: ["*"],
    priority: 1,
    when: { scan: { full: true }, match: "." },
    set: { phase: "empty" },
  },
];

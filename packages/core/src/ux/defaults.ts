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
        "rate\\s*limit|usage\\s*limit|quota\\s*exceed|hit your.*limit|limit reached|too many requests|429|OC-LIMIT",
    },
    set: { phase: "limit", kind: "oc-connect", border: "PROXY-DOWN" },
    onRise: "connectivity.proxy-down",
  },
  {
    id: "oc-limit",
    for: ["opencode", "claude"],
    priority: 85,
    when: {
      scan: { tailLines: 28 },
      match:
        "rate\\s*limit|usage\\s*limit|quota\\s*exceed|hit your.*limit|limit reached|too many requests|429|free[ -]?tier.*limit|plan limit|OC-LIMIT|zen.*limit|session\\s*(expired|limit|ended)|expired\\s*session|provider\\s*limit|free\\s*usage\\s*exceed|usage\\s*exceeded|subscribe to go",
    },
    set: { phase: "limit", kind: "oc-limit", border: "OC-LIMIT:oc-limit" },
    onRise: "connectivity.rate-limit",
  },
  {
    id: "cc-limit",
    for: ["claude"],
    priority: 84,
    when: {
      scan: { full: true },
      match: "rate limit|usage limit|try again|quota",
      unless:
        "rate\\s*limit|usage\\s*limit|quota\\s*exceed|hit your.*limit|limit reached|too many requests|429|OC-LIMIT|zen.*limit",
    },
    set: { phase: "limit", kind: "cc-limit", border: "OC-LIMIT:cc-limit" },
    onRise: "limits.cc-limit",
  },
  {
    id: "cursor-follow-up",
    for: ["cursor-agent"],
    priority: 70,
    when: { scan: { full: true }, match: "Add a follow-up|ctrl\\+c to stop" },
    set: { phase: "busy", busyLabel: "follow-up", border: "follow-up" },
  },
  {
    id: "cursor-composer",
    for: ["cursor-agent"],
    priority: 69,
    when: { scan: { full: true }, match: "Composer \\d|· \\d+\\.\\d+%|files edited" },
    set: { phase: "busy", busyLabel: "composer", border: "composer" },
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

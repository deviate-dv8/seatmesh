import type { Detection, PaneSnapshot, ComposerState, PromptCapture } from "seat-mesh-core";

/** Process cmdlines attached to snapshot (from pane tree walk). */
export function cmdlines(pane: PaneSnapshot): string[] {
  const raw = pane.options.processCmdlines ?? "";
  if (!raw) return [];
  return raw.split("\0").filter(Boolean);
}

export function matchAny(cmdlines: string[], patterns: RegExp[]): boolean {
  for (const line of cmdlines) {
    for (const re of patterns) {
      if (re.test(line)) return true;
    }
  }
  return false;
}

export function extractUuid(cmd: string, flags: string[]): string | undefined {
  for (const flag of flags) {
    const re = new RegExp(`${flag}[= ]([0-9a-fA-F-]{36})`);
    const m = cmd.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

const OC_SESSION_ID_RE = /\bses_[A-Za-z0-9]+\b/;
const OC_SESSION_ID_STRICT = /^ses_[A-Za-z0-9]+$/;

export function isOpenCodeSessionId(id: string | null | undefined): id is string {
  return Boolean(id && OC_SESSION_ID_STRICT.test(id.trim()));
}

/** Drop Claude/agent UUIDs and other junk stored in @mesh_oc_session by mistake. */
export function normalizeOpenCodeSessionId(
  id: string | null | undefined,
): string | undefined {
  const t = id?.trim();
  return isOpenCodeSessionId(t) ? t : undefined;
}

/** OpenCode session ids from CLI flags (--session / -s) or scrollback. */
export function extractOpenCodeSession(
  cmd: string,
  flags: string[] = ["--session", "-s"],
): string | undefined {
  for (const flag of flags) {
    const esc = flag.replace(/-/g, "\\-");
    const re = new RegExp(`${esc}[= ](ses_[A-Za-z0-9]+)`);
    const m = cmd.match(re);
    if (m?.[1]) return m[1];
  }
  const bare = cmd.match(OC_SESSION_ID_RE);
  return bare?.[0];
}

export function scrapeOpenCodeSessionFromCapture(tail: string): string | undefined {
  const hits = tail.match(new RegExp(OC_SESSION_ID_RE.source, "g"));
  return hits?.[hits.length - 1];
}

export function paneStoredOpenCodeSession(
  options: Record<string, string>,
): string | undefined {
  return normalizeOpenCodeSessionId(options.mesh_oc_session);
}

/** Best session id for `resume [id]` on a live OpenCode pane. Never returns Claude UUIDs. */
export function resolveOpenCodeSessionForPane(pane: PaneSnapshot): string | null {
  for (const cmd of cmdlines(pane)) {
    const s = extractOpenCodeSession(cmd);
    if (s) return s;
  }
  const stored = paneStoredOpenCodeSession(pane.options);
  if (stored) return stored;
  const fromCapture = scrapeOpenCodeSessionFromCapture(pane.captureTail);
  if (fromCapture) return fromCapture;
  return null;
}

export function formatOpenCodeResumeCommand(pane: PaneSnapshot): string | null {
  const sid = resolveOpenCodeSessionForPane(pane);
  return sid ? `resume [${sid}]` : null;
}

function bottomLines(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n");
}

/** OpenCode composer draft above the Build auto footer (harness parity). */
export function opencodeInputDraft(captureTail: string): string {
  const b = bottomLines(captureTail, 14);
  const lines = b.split("\n");
  let footerIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/Build\s+auto\s+·\s+Big Pickle\s+OpenCode Zen/i.test(lines[i]!)) {
      footerIdx = i;
      break;
    }
  }
  if (footerIdx <= 0) return "";
  const draftLines: string[] = [];
  let passedBlank = false;
  for (let i = footerIdx - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) {
      if (draftLines.length > 0) break;
      passedBlank = true;
      continue;
    }
    if (/^[^\x00-\x7f]+$/.test(trimmed) && !/\p{L}/u.test(trimmed)) {
      if (draftLines.length > 0) break;
      continue;
    }
    if (/^▣\s+Build\s+·/.test(trimmed)) {
      if (draftLines.length > 0) break;
      continue;
    }
    if (passedBlank) break;
    draftLines.unshift(trimmed);
  }
  const draft = draftLines.join(" ").trim();
  if (!draft || /Ask anything/i.test(draft)) return "";
  return draft;
}

/** Cursor agent composer draft (leading arrow row only). */
export function agentInputDraft(captureTail: string): string {
  const b = bottomLines(captureTail, 14);
  const drafts: string[] = [];
  for (const line of b.split("\n")) {
    if (!/^\s*\u2192(?:\s|$)/.test(line)) continue;
    const after = line.replace(/^\s*\u2192\s*/, "").trim();
    const cleaned = after.replace(/\s{2,}ctrl\+c to stop.*$/i, "").trim();
    if (!cleaned) continue;
    if (/^Add a follow-up$/i.test(cleaned)) continue;
    if (/^[\u258e\u2502]/.test(cleaned)) continue;
    if (/ctrl\+r to review/i.test(cleaned)) continue;
    drafts.push(cleaned);
  }
  return drafts.join("\n");
}

/** Live unsent composer text for coord-pane settle gate. */
export function coordComposerDraft(captureTail: string, providerId: string): string {
  if (providerId === "opencode") return opencodeInputDraft(captureTail);
  if (providerId === "cursor-agent") return agentInputDraft(captureTail);
  return "";
}

const OC_LIMIT_RE =
  /rate\s*limit|usage\s*limit|quota\s*exceed|hit your.*limit|limit reached|too many requests|\b429\b|free[ -]?tier.*limit|plan limit|OC-LIMIT|zen.*limit|session\s*(expired|limit|ended)|expired\s*session|provider\s*limit|free\s*usage\s*exceed|usage\s*exceeded|subscribe to go/i;
const OC_CONNECT_RE =
  /cannot\s+connect\s+to\s+api|unable\s+to\s+connect|service\s+unavailable|connection\s+error|ECONNREFUSED|socket\s+connection\s+was\s+closed/i;
const CC_LIMIT_RE =
  /rate limit|usage limit|try again|quota/i;

const OC_BUSY_RE =
  /Thinking|Working|Running|⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|esc interrupt/i;
const OC_COMPOSER_RE =
  /Ask anything|Ask a question|Type a message|Send a message|What would you like/i;

export function composerFromCapture(
  pane: PaneSnapshot,
  providerId: string,
): ComposerState {
  const tail = pane.captureTail;
  if (!tail.trim()) {
    return { phase: "plain_shell" };
  }

  if (providerId === "opencode") {
    const bottomLines = tail.split("\n").filter((l) => l.trim()).slice(-8);
    const bottom = bottomLines.join("\n");
    const atComposer =
      /ctrl\+p commands/i.test(bottom) || OC_COMPOSER_RE.test(bottom);
    // Live composer wins over stale limit/Thinking lines left in scrollback after resume.
    if (atComposer) {
      const recentBusy =
        /⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|esc interrupt/i.test(bottom) ||
        bottomLines.slice(-3).some((l) => /^(Working|Running|Thinking)\b/.test(l.trim()));
      if (!recentBusy) {
        return { phase: "empty" };
      }
    }
    const bottom28 = tail.split("\n").slice(-28).join("\n");
    if (OC_CONNECT_RE.test(bottom28) && !OC_LIMIT_RE.test(bottom28)) {
      return { phase: "limit", limitKind: "oc-connect" };
    }
    if (OC_LIMIT_RE.test(bottom28)) {
      return { phase: "limit", limitKind: "oc-limit" };
    }
  }
  if (providerId === "claude" && OC_LIMIT_RE.test(tail)) {
    return { phase: "limit", limitKind: "oc-limit" };
  }
  if (providerId === "claude" && CC_LIMIT_RE.test(tail)) {
    return { phase: "limit", limitKind: "cc-limit" };
  }

  if (providerId === "cursor-agent") {
    if (/Add a follow-up|ctrl\+c to stop/.test(tail)) {
      return { phase: "busy", busyLabel: "follow-up" };
    }
    if (/Composer \d|· \d+\.\d+%|files edited/.test(tail)) {
      return { phase: "busy", busyLabel: "composer" };
    }
  }

  if (/Working|Running|Thinking/.test(tail)) {
    const m = tail.match(/(Working|Running|Thinking[^\n]*)/);
    return { phase: "busy", busyLabel: m?.[1] ?? "busy" };
  }

  if (/AFK|Stuck|draft/.test(tail)) {
    return { phase: "afk" };
  }

  // Composer draft heuristic: only "typing" when a draft sits under a live prompt line
  const lines = tail.split("\n").filter((l) => l.trim());
  const last = lines.at(-1) ?? "";
  const promptMatch = last.match(/^[❯›>](.+)/);
  if (promptMatch && promptMatch[1]!.trim().length > 0) {
    return { phase: "typing", draftFingerprint: promptMatch[1]!.trim().slice(0, 80) };
  }

  return { phase: "empty" };
}

/** Default: empty or AFK composer (cursor/claude/kiro). */
export function defaultComposerReady(
  pane: PaneSnapshot,
  providerId: string,
): boolean {
  const state = composerFromCapture(pane, providerId);
  return state.phase === "empty" || state.phase === "afk";
}

/** OpenCode splash must show composer prompt before paste. */
export function opencodeComposerReady(pane: PaneSnapshot): boolean {
  const state = composerFromCapture(pane, "opencode");
  return state.phase === "empty" || state.phase === "afk";
}

const MANAGER_PREFIX_RE = /^\[agent-manager[^\]]*\]\s*/;
const PROMPT_LINE_RE = /^[❯›>]\s/;
const NOISE_LINE_RE =
  /^(Working|Running|Thinking|AFK|Stuck|typing|empty|plain_shell|\s*$)/i;

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (NOISE_LINE_RE.test(t)) return true;
  if (/^(esc|ctrl|enter)\b/i.test(t)) return true;
  return false;
}

function isNoiseBlock(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  if (/^(Working|Running|Thinking)/.test(t)) return true;
  return false;
}

/** Shared scrape heuristic for all CLI providers (pane capture, not chat UI). */
export function scrapePromptTurnGeneric(pane: PaneSnapshot): PromptCapture | null {
  const raw = pane.captureTail;
  if (!raw?.trim()) return null;

  const lines = [...raw.split("\n")];
  while (lines.length && isNoiseLine(lines[lines.length - 1]!)) {
    lines.pop();
  }
  if (!lines.length) return null;

  let humanStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line || isNoiseLine(line)) continue;
    if (MANAGER_PREFIX_RE.test(line) || PROMPT_LINE_RE.test(line)) {
      humanStart = i;
      break;
    }
  }

  if (humanStart < 0) {
    const blocks = raw
      .split(/\n\n+/)
      .map((b) => b.trim())
      .filter((b) => b && !isNoiseBlock(b));
    if (blocks.length < 2) return null;
    const human = blocks[blocks.length - 2]!;
    const response = blocks[blocks.length - 1]!;
    return { humanPrompt: human, agentResponse: response };
  }

  const firstHuman = lines[humanStart]!
    .replace(MANAGER_PREFIX_RE, "")
    .replace(PROMPT_LINE_RE, "")
    .trim();
  const humanLines = [firstHuman];
  let i = humanStart + 1;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l) break;
    if (PROMPT_LINE_RE.test(l) || MANAGER_PREFIX_RE.test(l)) break;
    humanLines.push(l);
  }
  let rs = i;
  while (rs < lines.length && !lines[rs]!.trim()) rs++;
  const response = lines
    .slice(rs)
    .filter((l) => !isNoiseLine(l))
    .join("\n")
    .trim();
  const human = humanLines.join("\n").trim();

  if (!human || !response || human.length < 2 || response.length < 2) return null;
  if (isNoiseBlock(response)) return null;
  return { humanPrompt: human, agentResponse: response };
}

export function sessionIdFromDetection(detection: Detection): string | undefined {
  return detection.resumeId;
}

export function extractFlagValue(cmd: string, flag: string): string | undefined {
  const re = new RegExp(`${flag}=([^\\s]+)|${flag}\\s+([^\\s]+)`);
  const m = cmd.match(re);
  return m?.[1] ?? m?.[2];
}

export function modelFromCmdlines(
  lines: string[],
  fallback?: string,
): string | undefined {
  for (const line of lines) {
    const m = extractFlagValue(line, "--model");
    if (m) return m;
  }
  return fallback;
}

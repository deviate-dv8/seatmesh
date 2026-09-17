import {
  claudeIdleEmptyComposer,
  isClaudeLiveComposerRow,
  stripMeshOwnedLines,
  type Detection,
  type PaneSnapshot,
  type ComposerState,
  type PromptCapture,
} from "@seat-mesh/core";

export { claudeIdleEmptyComposer, isClaudeLiveComposerRow };

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
  const b = bottomLines(captureTail, 18);
  const lines = b.split("\n");
  let footerIdx = -1;
  // Prefer the Build-auto status row when present (ctrl+p alone sits below it and
  // would otherwise treat "Build auto · …" as the draft).
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/Build\s+auto\s+·/i.test(lines[i]!)) {
      footerIdx = i;
      break;
    }
  }
  if (footerIdx < 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      if (
        /ctrl\+p commands/i.test(line) ||
        (/\bOpenCode\b/i.test(line) && /·|ctrl\+/i.test(line)) ||
        (/Ask anything|Type a message|Send a message/i.test(line) && i === lines.length - 1)
      ) {
        footerIdx = i;
        break;
      }
    }
  }
  if (footerIdx <= 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/ctrl\+p|ctrl\+t|esc\b/i.test(lines[i]!)) {
        footerIdx = i;
        break;
      }
    }
  }
  if (footerIdx <= 0) return "";

  // OC paints the live composer inside a ┃ box between the prior ▣ Build status
  // and the "Build auto ·" footer. Only those box rows are drafts — walking into
  // scrollback (assistant text) made clear loops never see empty and spam Escape,
  // which interrupts a live generation.
  const draftLines: string[] = [];
  for (let i = footerIdx - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed) {
      if (draftLines.length > 0) break;
      continue;
    }
    if (/^▣\s+Build\s+·/.test(trimmed) || /Build\s+auto\s+·/i.test(trimmed)) {
      break;
    }
    if (/ctrl\+p commands/i.test(trimmed)) {
      if (draftLines.length > 0) break;
      continue;
    }
    // Box row: "┃  text" / "│ text" / bare "┃"
    if (/^[┃│]/.test(trimmed)) {
      const box = trimmed.replace(/^[┃│]\s*/, "").trim();
      if (!box) continue;
      if (/^[▀]+$/.test(box)) continue;
      draftLines.unshift(box);
      continue;
    }
    // Non-box line above the composer = scrollback. Never vacuum it as a draft.
    break;
  }
  const draft = draftLines.join(" ").trim();
  if (!draft || /Ask anything|Type a message|Send a message|What would you like/i.test(draft)) {
    return "";
  }
  if (/^\[mesh-inbox/i.test(draft)) return "";
  return draft;
}

/** Cursor idle composer placeholders / gray ghost suggestions (not human drafts). */
const CURSOR_COMPOSER_PLACEHOLDER_RE =
  /^(?:Add a follow-up|Plan,\s*search,\s*build anything|Ask anything|Describe what you want|Build anything|What would you like to (?:do|build)\??)$/i;

/**
 * Strip dim/gray ANSI runs from a capture line (Cursor ghost-text ahead-of-cursor).
 * Ported from scripts/inbox-server.mjs stripAnsiGraySegments.
 */
export function stripAnsiGraySegments(raw: string): string {
  const parts = raw.split(/(\x1b\[[0-9;]*m)/);
  let curColor: number | "dim" | null = null;
  let out = "";
  for (const part of parts) {
    if (/^\x1b\[/.test(part)) {
      const m256 = /^\x1b\[38;5;(\d+)m$/.exec(part);
      if (m256) {
        curColor = Number(m256[1]);
        continue;
      }
      if (/^\x1b\[(0|39)m$/.test(part)) {
        curColor = null;
        continue;
      }
      if (/^\x1b\[2m$/.test(part)) {
        curColor = "dim";
        continue;
      }
      if (/^\x1b\[22m$/.test(part)) {
        if (curColor === "dim") curColor = null;
        continue;
      }
      continue;
    }
    const isGray =
      curColor === "dim" ||
      (typeof curColor === "number" && curColor >= 238 && curColor <= 250);
    if (!isGray) out += part;
  }
  return out;
}

function agentArrowLineDraft(plainLine: string, ansiLine?: string): string {
  if (!/^\s*\u2192(?:\s|$)/.test(plainLine)) return "";
  let after = plainLine.replace(/^\s*\u2192\s*/, "").trim();
  after = after.replace(/\s{2,}ctrl\+c to stop.*$/i, "").trim();
  if (ansiLine && /\u2192/.test(ansiLine)) {
    const stripped = stripAnsiGraySegments(ansiLine);
    const m = stripped.match(/^\s*\u2192\s*(.*)$/);
    if (m) {
      after = (m[1] ?? "")
        .replace(/\s{2,}ctrl\+c to stop.*$/i, "")
        .trim();
    }
  }
  if (!after) return "";
  if (CURSOR_COMPOSER_PLACEHOLDER_RE.test(after)) return "";
  if (/^[\u258e\u2502]/.test(after)) return "";
  if (/ctrl\+r to review/i.test(after)) return "";
  // Checkback / mesh-inbox chrome uses the same arrow marker — never a human draft.
  if (/^\[mesh-inbox/i.test(after)) return "";
  if (/^intent=/i.test(after)) return "";
  if (/^Check:/i.test(after)) return "";
  return after;
}

/** Cursor agent composer draft (leading arrow row only). */
export function agentInputDraft(captureTail: string, captureTailAnsi?: string): string {
  const b = bottomLines(captureTail, 14);
  const bAnsi = captureTailAnsi ? bottomLines(captureTailAnsi, 14) : "";
  const plainLines = b.split("\n");
  const ansiLines = bAnsi ? bAnsi.split("\n") : [];
  const drafts: string[] = [];
  for (let i = 0; i < plainLines.length; i++) {
    const line = plainLines[i]!;
    const ansiLine = ansiLines[i];
    const cleaned = agentArrowLineDraft(line, ansiLine);
    if (cleaned) drafts.push(cleaned);
  }
  return drafts.join("\n");
}

/** Claude Code UI hint that reuses the "❯" marker but is never a human draft. */
const CLAUDE_NON_DRAFT_HINT_RE = /^Press up to edit queued messages$/i;

/**
 * Claude's composer draft — collects wrapped continuation lines, not just the
 * first visual line (a footer-bleed root cause: a multi-line human draft under
 * a live "❯ " prompt only shows the "❯" on its first row, so a last-line-only
 * check reports "empty" mid-keystroke on co-typed panes; FQ-inject-co-typed-pane).
 */
export function claudeInputDraft(captureTail: string): string {
  const lines = captureTail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*❯\s+(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    if (!isClaudeLiveComposerRow(lines, i)) continue;
    const first = (m[1] ?? "").trim();
    if (isPlaceholderPromptContent(first)) return "";
    if (CLAUDE_NON_DRAFT_HINT_RE.test(first)) return "";
    const parts = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j] ?? "";
      const trimmed = cont.trim();
      if (!trimmed) break;
      if (/^\s*❯\s/.test(cont)) break;
      if (RULE_LINE_RE.test(trimmed)) break;
      if (/auto mode on|shift\+tab to cycle/i.test(cont)) break;
      parts.push(trimmed);
    }
    return parts.join(" ").trim();
  }
  return "";
}

/** Live unsent composer text for coord-pane settle gate. */
export function coordComposerDraft(
  captureTail: string,
  providerId: string,
  captureTailAnsi?: string,
): string {
  if (providerId === "opencode") return opencodeInputDraft(captureTail);
  if (providerId === "cursor-agent" || providerId === "agent") {
    return agentInputDraft(captureTail, captureTailAnsi);
  }
  if (providerId === "claude") return claudeInputDraft(captureTail);
  if (providerId === "kiro") return kiroInputDraft(captureTail);
  return "";
}

/**
 * Kiro chat composer draft. Same ❯/›/> family as Claude, but without Claude's
 * divider-chip gate (kiro layout differs — that gate left every draft empty).
 */
export function kiroInputDraft(captureTail: string): string {
  const lines = captureTail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*[❯›>]\s+(.*)$/.exec(lines[i] ?? "");
    if (!m) continue;
    const first = (m[1] ?? "").trim();
    if (isPlaceholderPromptContent(first)) continue;
    if (CLAUDE_NON_DRAFT_HINT_RE.test(first)) continue;
    if (/^\[mesh-inbox/i.test(first)) continue;
    if (/^intent=/i.test(first)) continue;
    if (/^Check:/i.test(first)) continue;
    // Divider-sandwiched chrome (suggested chips) — skip.
    const prev = (lines[i - 1] ?? "").trim();
    const next = (lines[i + 1] ?? "").trim();
    if (RULE_LINE_RE.test(prev) && RULE_LINE_RE.test(next)) continue;
    const parts = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j] ?? "";
      const trimmed = cont.trim();
      if (!trimmed) break;
      if (/^\s*[❯›>]\s/.test(cont)) break;
      if (RULE_LINE_RE.test(trimmed)) break;
      if (/ctrl\+|shift\+tab|auto mode/i.test(cont)) break;
      parts.push(trimmed);
    }
    return parts.join(" ").trim();
  }
  return "";
}

const OC_LIMIT_RE =
  /rate\s*limit|usage\s*limit|quota\s*exceed|hit your.*limit|limit reached|too many requests|\b429\b|free[ -]?tier.*limit|plan limit|zen.*limit|session\s*(expired|limit|ended)|expired\s*session|provider\s*limit|free\s*usage\s*exceed|usage\s*exceeded|subscribe to go/i;
const OC_CONNECT_RE =
  /cannot\s+connect\s+to\s+api|unable\s+to\s+connect|service\s+unavailable|connection\s+error|ECONNREFUSED|socket\s+connection\s+was\s+closed/i;
/**
 * OrcaRouter / OpenCode-as-router credit gate — intermittent upstream, not CPE rate-limit.
 * Do NOT fold into oc-limit (that arms CPE reboot). Recovery = atomic 4 CONTINUE.
 */
const OC_CREDIT_RE =
  /insufficient_user_quota|out of credits|needs\s*\$[\d.]+|orcarouter\.ai\/console\/billing|err_credit_gate|Add credits to keep going/i;
const CC_LIMIT_RE =
  /rate limit|usage limit|try again|quota/i;
/** kiro-cli monthly/quota wall — hold inject (queue) and continue other seats. */
const KIRO_LIMIT_RE =
  /monthly\s+usage\s+limit\s+has\s+been\s+reached|usage\s+limit\s+has\s+been\s+reached(?:\s*\(\s*request_id:)?|you(?:'ve| have)\s+reached\s+(?:your\s+)?(?:monthly\s+)?usage\s+limit|request_id:\s*[0-9a-fA-F-]{8,}/i;

const OC_BUSY_RE =
  /Thinking|Working|Running|⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|esc interrupt/i;
const OC_COMPOSER_RE =
  /Ask anything|Ask a question|Type a message|Send a message|What would you like/i;

/** A run of box-drawing/rule characters — a decorative divider, never real composer text. */
const RULE_LINE_RE = /^[\s─━│┃┆┊╌╍┄┅╭╮╰╯┌┐└┘┏┓┗┛┣┫┳┻╋=_.\-]{3,}$/;

/**
 * True when a `❯ ...`-prefixed line is Claude Code UI chrome (a dimmed suggested-reply
 * chip, or a bordered box) rather than a live unsent composer draft. Both render with the
 * same `❯` marker in plain-text capture (color/dim styling is stripped by `-p` capture),
 * so the only surviving plain-text signal is that chrome is sandwiched between rule/divider
 * lines immediately above and/or below it — a real draft sits directly above the bottom
 * shortcuts footer with no divider in between.
 */
export function isDecorativeChromeNeighbor(prevLine: string, nextLine: string): boolean {
  return RULE_LINE_RE.test(prevLine.trim()) || RULE_LINE_RE.test(nextLine.trim());
}

/** Claude/Cursor prompt row with only rules/spaces — empty composer, not a human draft. */
export function isPlaceholderPromptContent(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (RULE_LINE_RE.test(t)) return true;
  if (/^[\s─━│┃┆┊╌╍┄┅╭╮╰╯┌┐└┘┏┓┗┛┣┫┳┻╋=_.\-]+$/.test(t)) return true;
  return false;
}

export function composerFromCapture(
  pane: PaneSnapshot,
  providerId: string,
): ComposerState {
  const tail = stripMeshOwnedLines(pane.captureTail);
  if (!tail.trim()) {
    // Brief blank redraw while CLI is still live — do not wedge as plain_shell.
    const cmd = (pane.currentCommand ?? "").trim();
    if (/^(agent|cursor-agent|claude|opencode|node)$/i.test(cmd)) {
      return { phase: "empty" };
    }
    return { phase: "plain_shell" };
  }

  if (providerId === "opencode") {
    const bottomLines = tail.split("\n").filter((l) => l.trim()).slice(-8);
    const bottom = bottomLines.join("\n");
    const bottom28 = tail.split("\n").slice(-28).join("\n");
    // Credit gate: scan a wide band — error often sits above ctrl+p chrome.
    const creditBand = tail.split("\n").slice(-80).join("\n");
    if (
      OC_CREDIT_RE.test(bottom) ||
      OC_CREDIT_RE.test(bottom28) ||
      OC_CREDIT_RE.test(creditBand)
    ) {
      return { phase: "limit", limitKind: "oc-credit" };
    }
    const atComposer =
      /ctrl\+p commands/i.test(bottom) || OC_COMPOSER_RE.test(bottom);
    // Live composer wins over stale limit/connect lines left in scrollback after resume.
    // Must return here on busy too — otherwise bottom8 still matches "Cannot connect" while
    // tokens stream and sticky PROXY-DOWN never clears.
    if (atComposer) {
      const recentBusy =
        /⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|esc interrupt/i.test(bottom) ||
        bottomLines.slice(-3).some((l) => /^(Working|Running|Thinking)\b/.test(l.trim()));
      if (recentBusy) {
        return { phase: "busy", busyLabel: "busy" };
      }
      const ocDraft = opencodeInputDraft(tail);
      if (ocDraft) {
        return { phase: "typing", draftFingerprint: ocDraft.slice(0, 80) };
      }
      return { phase: "empty" };
    }
    // Prefer the live bottom band (same window as empty/busy) — bottom28 keeps stale connect errors forever.
    const bottom8 = bottom;
    if (OC_CONNECT_RE.test(bottom8) && !OC_LIMIT_RE.test(bottom8)) {
      return { phase: "limit", limitKind: "oc-connect" };
    }
    if (OC_LIMIT_RE.test(bottom8) || OC_LIMIT_RE.test(bottom28)) {
      return { phase: "limit", limitKind: "oc-limit" };
    }
  }
  if (providerId === "claude") {
    // CC before any generic OC_LIMIT_RE — shared phrases ("rate limit", "quota") match both;
    // mis-tagging CC as oc-limit triggers OC proxy recovery and wrong borders.
    if (CC_LIMIT_RE.test(tail)) {
      return { phase: "limit", limitKind: "cc-limit" };
    }
    const bottomLines = tail.split("\n").filter((l) => l.trim()).slice(-4);
    const active = bottomLines.some((l) => /^(Working|Running|Thinking)\b/.test(l.trim()));
    if (active) {
      const m = bottomLines.join("\n").match(/(Working|Running|Thinking[^\n]*)/);
      return { phase: "busy", busyLabel: m?.[1] ?? "busy" };
    }
    const clDraft = claudeInputDraft(tail);
    if (clDraft) {
      return { phase: "typing", draftFingerprint: clDraft.slice(0, 80) };
    }
    if (claudeIdleEmptyComposer(tail)) {
      return { phase: "empty" };
    }
    // Claude does not use CPE :18887 — ignore stale OC connect text in scrollback.
  }

  if (providerId === "cursor-agent") {
    const bottom = tail.split("\n").slice(-14).join("\n");
    if (/out of usage|Increase limits for faster responses/i.test(bottom)) {
      return { phase: "limit", limitKind: "cursor-usage-limit" };
    }
    const generating =
      /Working|Running|Thinking|enter steer|ctrl\+c to stop/i.test(bottom);
    if (generating) {
      if (/Add a follow-up|ctrl\+c to stop/.test(bottom)) {
        return { phase: "busy", busyLabel: "follow-up" };
      }
      const m = bottom.match(/(Working|Running|Thinking[^\n]*)/);
      return { phase: "busy", busyLabel: m?.[1] ?? "busy" };
    }
    const agentDraft = agentInputDraft(tail, pane.captureTailAnsi);
    if (agentDraft) {
      return { phase: "typing", draftFingerprint: agentDraft.slice(0, 80) };
    }
    // Idle post-turn chrome (follow-up box / composer footer) — inbox may inject.
    // Cursor often paints "Compose·" (no "Composer N") in the footer.
    if (
      /Add a follow-up|Composer \d|Compose[·.]|· \d+\.\d+%|files edited|Run Everything/i.test(
        bottom,
      )
    ) {
      return { phase: "empty" };
    }
  }

  if (providerId === "kiro") {
    // Detect monthly usage wall before busy/typing — inbox holds (queues) and continues.
    if (KIRO_LIMIT_RE.test(tail)) {
      return { phase: "limit", limitKind: "kiro-limit" };
    }
    const bottom = tail.split("\n").slice(-10).join("\n");
    if (/Working|Running|Thinking|Generating/i.test(bottom)) {
      const m = bottom.match(/(Working|Running|Thinking|Generating[^\n]*)/i);
      return { phase: "busy", busyLabel: m?.[1] ?? "busy" };
    }
    const kDraft = kiroInputDraft(tail);
    if (kDraft) {
      return { phase: "typing", draftFingerprint: kDraft.slice(0, 80) };
    }
  }

  if (providerId !== "claude" && providerId !== "kiro" && /Working|Running|Thinking/.test(tail)) {
    const m = tail.match(/(Working|Running|Thinking[^\n]*)/);
    return { phase: "busy", busyLabel: m?.[1] ?? "busy" };
  }
  if (/AFK|Stuck|draft/.test(tail)) {
    return { phase: "afk" };
  }

  // Composer draft heuristic: only "typing" when a draft sits under a live prompt line
  const rawLines = tail.split("\n");
  const lines = rawLines.filter((l) => l.trim());
  const last = lines.at(-1) ?? "";
  const lastRawIdx = rawLines.lastIndexOf(last);
  const promptMatch = last.match(/^[❯›>](.+)/);
  if (promptMatch && !isDecorativeChromeNeighbor(rawLines[lastRawIdx - 1] ?? "", rawLines[lastRawIdx + 1] ?? "")) {
    const draft = promptMatch[1]!.trim();
    if (!isPlaceholderPromptContent(draft)) {
      return { phase: "typing", draftFingerprint: draft.slice(0, 80) };
    }
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
  const tail = pane.captureTail ?? "";
  if (/esc exit shell mode/i.test(tail)) {
    return false;
  }
  const atComposer =
    /ctrl\+p commands/i.test(tail) || OC_COMPOSER_RE.test(tail);
  // Connect tip can stay visible below a live composer — only block boot splash.
  if (!atComposer && /● Tip Run \/connect/i.test(tail)) {
    return false;
  }
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

/** OpenCode UI chrome — never a human prompt or agent reply for ChatFile. */
function isOpenCodeChromeText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^▣\s*Build\s*·/i.test(t)) return true;
  if (/Build\s+auto\s+·/i.test(t)) return true;
  if (/ctrl\+p commands/i.test(t)) return true;
  if (/^\/home\//i.test(t) && /ctrl\+p|OpenCode/i.test(t)) return true;
  if (/esc\s*interrupt/i.test(t)) return true;
  if (/^[┃│╹▀\s]+$/.test(t)) return true;
  if (/^Click to expand$/i.test(t)) return true;
  if (/^\+?\s*Thought:/i.test(t)) return true;
  if (/^[⠏⠋⠙⠹⠸⠼⠴⠦⠧⠇]\s*(Thinking|Working|Running)?/i.test(t)) return true;
  return false;
}

function stripOpenCodeBoxPrefix(line: string): string {
  return line.replace(/^\s*[┃│]\s?/, "").trimEnd();
}

function isOpenCodeBoxLine(line: string): boolean {
  return /^\s*[┃│]/.test(line);
}

/**
 * OpenCode completed turn: user text lives in a ┃ box, then the assistant reply,
 * then `▣ Build · … · <duration>`. Empty composer + footer / in-flight Build
 * (no duration) must not become a turn.
 */
export function scrapePromptTurnOpenCode(pane: PaneSnapshot): PromptCapture | null {
  const raw = pane.captureTail ?? "";
  if (!raw.trim()) return null;
  const lines = raw.split("\n");

  // Completed status has a duration after the second · (e.g. "· 3.9s", "· 2m 58s").
  // In-flight "▣  Build · Big Pickle" (no duration) is still generating — skip it.
  const COMPLETED_BUILD_RE = /^\s*▣\s*Build\s*·[^·\n]+·\s*\d/i;

  let buildIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (COMPLETED_BUILD_RE.test(lines[i] ?? "")) {
      buildIdx = i;
      break;
    }
  }
  if (buildIdx <= 0) return null;

  // Walk up from ▣ Build: skip blanks, collect agent reply until a content ┃ box.
  const replyLines: string[] = [];
  let i = buildIdx - 1;
  while (i >= 0 && !(lines[i] ?? "").trim()) i--;
  for (; i >= 0; i--) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      if (replyLines.length > 0) {
        replyLines.unshift("");
      }
      continue;
    }
    if (/^\s*▣\s*Build\s*·/i.test(trimmed)) break;
    if (isOpenCodeBoxLine(line)) {
      const box = stripOpenCodeBoxPrefix(line).trim();
      if (!box) continue;
      break;
    }
    if (isOpenCodeChromeText(trimmed)) continue;
    replyLines.unshift(trimmed);
  }

  while (i >= 0 && !(lines[i] ?? "").trim()) i--;
  const promptLines: string[] = [];
  for (; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!isOpenCodeBoxLine(line)) {
      if (promptLines.length > 0) break;
      break;
    }
    const box = stripOpenCodeBoxPrefix(line).trim();
    if (!box) {
      if (promptLines.length > 0) break;
      continue;
    }
    if (/^QUEUED$/i.test(box)) continue;
    if (isOpenCodeChromeText(box)) continue;
    promptLines.unshift(box);
  }

  const humanPrompt = promptLines.join(" ").replace(/\s+/g, " ").trim();
  const agentResponse = replyLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!humanPrompt || !agentResponse) return null;
  if (isOpenCodeChromeText(humanPrompt) || isOpenCodeChromeText(agentResponse)) return null;
  if (humanPrompt.length < 2 || agentResponse.length < 2) return null;
  if (/^\+?\s*Thought:/i.test(agentResponse) && agentResponse.length < 40) return null;
  return { humanPrompt, agentResponse };
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
      .filter((b) => b && !isNoiseBlock(b) && !isOpenCodeChromeText(b));
    if (blocks.length < 2) return null;
    const human = blocks[blocks.length - 2]!;
    const response = blocks[blocks.length - 1]!;
    if (isOpenCodeChromeText(human) || isOpenCodeChromeText(response)) return null;
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
  if (isNoiseBlock(response) || isOpenCodeChromeText(human) || isOpenCodeChromeText(response)) {
    return null;
  }
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

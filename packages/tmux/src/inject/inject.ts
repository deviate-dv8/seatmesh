import { spawnSync } from "node:child_process";
import type { InjectPlan } from "@seat-mesh/core";
import { claudeIdleEmptyComposer, coordComposerDraft } from "@seat-mesh/providers";
import { withPaneInjectLock } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { humanDraftToPreserve, isSmInjectText } from "./inject-draft.js";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

/** @deprecated use withPaneInjectLock — kept for callers outside inject path */
export function withPaneInputEnabled(paneId: string, fn: () => void): void {
  withPaneInjectLock(paneId, fn);
}

// Named buffers — never touch tmux default (operator copy/paste).
const SM_INJECT_BUFFER = "sm-inject";
const SM_DRAFT_BUFFER = "sm-draft-restore";

function freshCapture(paneId: string, lines = 14): { tail: string; ansi?: string } {
  return {
    tail: tmux(["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`]).out ?? "",
    ansi: tmux(["capture-pane", "-t", paneId, "-p", "-S", `-${lines}`, "-e"]).out,
  };
}

function pasteMessage(paneId: string, message: string): void {
  const loaded = spawnSync("tmux", ["load-buffer", "-b", SM_INJECT_BUFFER, "-"], {
    input: message,
    encoding: "utf8",
  });
  if (loaded.status === 0) {
    const pasted = tmux(["paste-buffer", "-b", SM_INJECT_BUFFER, "-t", paneId, "-d"]);
    if (!pasted.ok) {
      tmux(["send-keys", "-t", paneId, "-l", message]);
    }
  } else {
    tmux(["send-keys", "-t", paneId, "-l", message]);
  }
}

/** Copy human draft to a dedicated buffer before clear/paste (restore after submit). */
function saveDraftBuffer(draft: string): void {
  if (!draft.trim()) {
    spawnSync("tmux", ["delete-buffer", "-b", SM_DRAFT_BUFFER], { encoding: "utf8" });
    return;
  }
  spawnSync("tmux", ["load-buffer", "-b", SM_DRAFT_BUFFER, "-"], {
    input: draft,
    encoding: "utf8",
  });
}

function restoreDraftBuffer(paneId: string): void {
  const buf = spawnSync("tmux", ["show-buffer", "-b", SM_DRAFT_BUFFER], { encoding: "utf8" });
  if (buf.status !== 0 || !buf.stdout?.trim()) return;
  tmux(["paste-buffer", "-b", SM_DRAFT_BUFFER, "-t", paneId, "-d"]);
}

/**
 * Cursor keeps an always-ready follow-up box — 200ms is enough.
 * Claude / Kiro / OpenCode often still show Working/spinner (or no live prompt)
 * after Enter; paste then misses the composer. Wait until empty composer is
 * visible, then restore (never Enter).
 */
function waitComposerReadyForRestore(paneId: string, providerId: string): void {
  if (providerId === "cursor-agent" || providerId === "agent") {
    sleepMs(200);
    return;
  }
  const lines =
    providerId === "claude" || providerId === "kiro" || providerId === "opencode" ? 24 : 16;
  const maxMs = providerId === "opencode" ? 5500 : 4500;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { tail, ansi } = freshCapture(paneId, lines);
    const draft = coordComposerDraft(tail, providerId, ansi).trim();
    if (draft && isSmInjectText(draft)) {
      sleepMs(180);
      continue;
    }
    // Non-empty non-inject draft already there — don't clobber; bail.
    if (draft) return;

    if (providerId === "claude") {
      if (claudeIdleEmptyComposer(tail) || /^\s*❯\s*$/m.test(tail)) return;
      // Still Working with no live ❯ — keep waiting.
      const bottom = tail.split("\n").slice(-8).join("\n");
      if (/^(Working|Running|Thinking)\b/m.test(bottom)) {
        sleepMs(200);
        continue;
      }
      sleepMs(160);
      continue;
    }

    if (providerId === "opencode") {
      const bottom = tail.split("\n").slice(-10).join("\n");
      // Escape interrupts a live OC generation — never send it while busy.
      if (
        /⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇/i.test(bottom) ||
        /esc\s*interrupt/i.test(bottom)
      ) {
        sleepMs(200);
        continue;
      }
      if (/ctrl\+p commands|Build\s+auto|Ask anything|Type a message|Send a message/i.test(bottom)) {
        // Idle composer — paste restore without Escape (Escape can still interrupt).
        return;
      }
      sleepMs(180);
      continue;
    }

    if (providerId === "kiro") {
      const bottom = tail.split("\n").slice(-10).join("\n");
      if (/Working|Running|Thinking|Generating/i.test(bottom) && !/^\s*[❯›>]\s*$/m.test(tail)) {
        sleepMs(200);
        continue;
      }
      if (/^\s*[❯›>]\s*$/m.test(tail) || /^\s*[❯›>]\s+/m.test(tail)) return;
      sleepMs(160);
      continue;
    }

    sleepMs(150);
    return;
  }
}

/**
 * Live human composer text — always fresh capture; mesh-inbox body does not skip save.
 * humanDraftToPreserve filters sm/chrome; stale [mesh-inbox] in composer is not restored.
 */
function captureHumanDraft(
  paneId: string,
  providerId: string,
  message: string,
  lines = 14,
): string {
  const { tail, ansi } = freshCapture(paneId, lines);
  return humanDraftToPreserve(tail, providerId, message, ansi);
}

function composerHasStaleInject(paneId: string, providerId: string, lines = 14): boolean {
  const { tail, ansi } = freshCapture(paneId, lines);
  const raw = coordComposerDraft(tail, providerId, ansi).trim();
  return raw.length > 0 && isSmInjectText(raw);
}

function clearComposerDraft(paneId: string, providerId: string, generating: boolean): void {
  if (generating) {
    tmux(["send-keys", "-t", paneId, "C-u"]);
    sleepMs(60);
    return;
  }
  if (providerId === "cursor-agent" || providerId === "agent") {
    for (let pass = 0; pass < 10; pass++) {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(90);
      tmux(["send-keys", "-t", paneId, "C-u"]);
      sleepMs(70);
      tmux(["send-keys", "-t", paneId, "C-u"]);
      sleepMs(70);
      const tail = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-14"]).out ?? "";
      const ansi = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-14", "-e"]).out;
      const left = coordComposerDraft(tail, "cursor-agent", ansi).trim();
      if (!left) break;
    }
    return;
  }
  if (providerId === "opencode") {
    // Escape interrupts OC generation. Prefer C-u; only Escape when idle clear stalls.
    for (let pass = 0; pass < 8; pass++) {
      const { tail: before, ansi: beforeAnsi } = freshCapture(paneId, 14);
      const busy =
        /⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇/i.test(before) || /esc\s*interrupt/i.test(before);
      if (!busy && pass > 0) {
        tmux(["send-keys", "-t", paneId, "Escape"]);
        sleepMs(70);
      }
      tmux(["send-keys", "-t", paneId, "C-u"]);
      sleepMs(60);
      tmux(["send-keys", "-t", paneId, "C-u"]);
      sleepMs(60);
      const { tail, ansi } = freshCapture(paneId, 14);
      if (!coordComposerDraft(tail, "opencode", ansi).trim()) break;
      // Still non-empty while busy — C-u only, never escalate to Escape.
      if (busy) continue;
    }
    return;
  }
  // Claude — Esc + C-u with verify (agent-parity; plain C-u misses multi-line ❯).
  // kiro — C-u only (Escape on kiro-cli can create empty submitted turns → 3 prompts).
  if (providerId === "kiro") {
    for (let pass = 0; pass < 6; pass++) {
      tmux(["send-keys", "-t", paneId, "C-u"]);
      sleepMs(70);
      tmux(["send-keys", "-t", paneId, "C-u"]);
      sleepMs(70);
      const { tail, ansi } = freshCapture(paneId, 14);
      const left = coordComposerDraft(tail, "kiro", ansi).trim();
      if (!left) break;
    }
    return;
  }
  for (let pass = 0; pass < 8; pass++) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(80);
    tmux(["send-keys", "-t", paneId, "C-u"]);
    sleepMs(70);
    tmux(["send-keys", "-t", paneId, "C-u"]);
    sleepMs(70);
    const { tail, ansi } = freshCapture(paneId, 14);
    const left = coordComposerDraft(tail, providerId || "claude", ansi).trim();
    if (!left) break;
  }
}

function submitInject(paneId: string, plan: InjectPlan, message: string, providerId: string): void {
  if (plan.skipSubmit) return;
  if (providerId === "cursor-agent" || providerId === "agent") {
    // Cursor often needs a double Enter (paste settle + submit). Third was
    // legacy belt-and-suspenders — keep two max so we never fire 3 prompts.
    const delayMs = message.length > 400 ? 650 : 450;
    sleepMs(delayMs);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    sleepMs(350);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    return;
  }
  if (providerId === "claude") {
    sleepMs(plan.enterDelayMs ?? 200);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    sleepMs(400);
    const after = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-6"]).out ?? "";
    if (/Press up to edit queued messages/i.test(after)) {
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(300);
    }
    return;
  }
  if (providerId === "kiro") {
    // kiro-cli: one Enter only. Esc loops during clear were creating empty
    // turns; never re-use cursor's multi-Enter path for kiro.
    sleepMs(plan.enterDelayMs ?? 250);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    return;
  }
  sleepMs(plan.enterDelayMs ?? 150);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

/**
 * Canonical inject sequence (all providers):
 * 1. capture human draft → dedicated buffer
 * 2. clear composer (incl. stale sm inject)
 * 3. paste inbox
 * 4. submit
 * 5. restore human draft
 *
 * tmux pane_input_off blocks daemon send-keys too — cannot "user-only lock".
 * withPaneInjectLock preserves focus + restores mini input-off after inject.
 */
function runInjectSequence(
  paneId: string,
  message: string,
  plan: InjectPlan,
  providerId: string,
  opts: {
    captureLines?: number;
    generating?: boolean;
    beforeClear?: () => void;
    shouldClear?: (ctx: { saved: string; meshInject: boolean; stale: boolean }) => boolean;
    afterClear?: () => void;
    postPaste?: () => void;
  } = {},
): void {
  const meshInject = isSmInjectText(message);
  const saved = captureHumanDraft(paneId, providerId, message, opts.captureLines ?? 14);
  saveDraftBuffer(saved);

  const stale = composerHasStaleInject(paneId, providerId, opts.captureLines ?? 14);
  opts.beforeClear?.();
  const willClear =
    opts.shouldClear?.({ saved, meshInject, stale }) ?? Boolean(saved || meshInject || stale);
  if (willClear) {
    clearComposerDraft(paneId, providerId, opts.generating ?? false);
  } else if (plan.flushEscFirst) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(120);
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(150);
  }
  opts.afterClear?.();

  pasteMessage(paneId, message);
  opts.postPaste?.();

  submitInject(paneId, plan, message, providerId);

  if (saved) {
    waitComposerReadyForRestore(paneId, providerId);
    restoreDraftBuffer(paneId);
  }
}

/** Cursor-agent paste with bracketed-paste guard + generating/follow-up edge cases. */
function injectCursorAgent(
  paneId: string,
  message: string,
  plan: InjectPlan,
  _captureTail: string,
  _captureTailAnsi?: string,
): void {
  const { tail: liveTail } = freshCapture(paneId, 14);
  const bottom = liveTail.split("\n").slice(-14).join("\n");
  const generating = /Working|Running|Thinking|enter steer/.test(bottom);
  const followUp = /Add a follow-up/.test(bottom);
  const meshInject = isSmInjectText(message);
  const hadDraft = Boolean(captureHumanDraft(paneId, "cursor-agent", message, 14));
  const stale = composerHasStaleInject(paneId, "cursor-agent", 14);

  runInjectSequence(paneId, message, plan, "cursor-agent", {
    generating,
    afterClear: () => {
      if (!hadDraft && !meshInject && !stale && !generating && !followUp && /→/.test(bottom)) {
        tmux(["send-keys", "-t", paneId, "Escape"]);
        sleepMs(250);
      }
    },
  });
}

/** Claude Code: clear stuck composer draft before paste (else inject is invisible). */
function injectClaude(paneId: string, message: string, plan: InjectPlan): void {
  runInjectSequence(paneId, message, plan, "claude", {
    captureLines: 24,
    beforeClear: () => {
      if (plan.flushEscFirst) {
        tmux(["send-keys", "-t", paneId, "Escape"]);
        sleepMs(120);
        tmux(["send-keys", "-t", paneId, "Escape"]);
        sleepMs(150);
      }
    },
    shouldClear: ({ saved, meshInject, stale }) => {
      if (saved || meshInject || stale) return true;
      const bottom = freshCapture(paneId, 8).tail;
      return /^❯\s/m.test(bottom) || /\n❯\s/m.test(bottom);
    },
  });
}

/** OpenCode: clear footer draft before paste; restore after submit (agent-parity clear loop). */
function injectOpenCode(paneId: string, message: string, plan: InjectPlan): void {
  const { tail } = freshCapture(paneId, 14);
  const generating = /esc interrupt|⠏|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇/i.test(tail);
  runInjectSequence(paneId, message, plan, "opencode", {
    captureLines: 24,
    generating,
    shouldClear: ({ saved, meshInject, stale }) => {
      if (saved || meshInject || stale) return true;
      return Boolean(coordComposerDraft(freshCapture(paneId, 14).tail, "opencode").trim());
    },
  });
}

/** Direct pane inject (orchestrator path). */
export function injectToPane(
  paneId: string,
  message: string,
  plan: InjectPlan,
  providerId?: string,
  _captureTail = "",
  _captureTailAnsi?: string,
): void {
  withPaneInjectLock(paneId, () => {
    sleepMs(150);
    const prov = providerId ?? "";
    if (prov === "cursor-agent" || prov === "agent") {
      injectCursorAgent(paneId, message, plan, _captureTail, _captureTailAnsi);
      return;
    }
    if (prov === "claude") {
      injectClaude(paneId, message, plan);
      return;
    }
    if (prov === "opencode") {
      injectOpenCode(paneId, message, plan);
      return;
    }
    if (prov === "kiro") {
      runInjectSequence(paneId, message, plan, "kiro", {
        captureLines: 24,
        shouldClear: ({ saved, meshInject, stale }) => Boolean(saved || meshInject || stale),
      });
      return;
    }
    runInjectSequence(paneId, message, plan, prov);
  });
}

/** Rescue Enter only — unstick Cursor composer / enter steer (harness flush). */
export function flushToPane(paneId: string, providerId: string): void {
  withPaneInjectLock(paneId, () => {
    const bottom =
      tmux(["capture-pane", "-t", paneId, "-p", "-S", "-14"]).out ?? "";
    if (providerId === "cursor-agent" && /enter steer/i.test(bottom)) {
      sleepMs(200);
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(250);
      tmux(["send-keys", "-t", paneId, "Enter"]);
      return;
    }
    sleepMs(250);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    if (providerId === "cursor-agent") {
      sleepMs(300);
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(250);
      const tail = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-12"]).out ?? "";
      if (
        !/Working|Running|Thinking/.test(tail) &&
        /→/.test(tail) &&
        !/Add a follow-up/i.test(tail)
      ) {
        tmux(["send-keys", "-t", paneId, "Escape"]);
        sleepMs(200);
      }
    }
  });
}

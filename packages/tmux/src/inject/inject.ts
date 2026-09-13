import { spawnSync } from "node:child_process";
import type { InjectPlan } from "@seat-mesh/core";
import { coordComposerDraft } from "@seat-mesh/providers";
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

// Named buffer — never touch the default tmux paste buffer, which is the same one
// mouse-select / prefix+[ copy-mode use. Every inject was silently clobbering
// whatever the operator had actually copied (operator-reported: "why does my copy keep
// getting saved over").
const SM_INJECT_BUFFER = "sm-inject";

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
  tmux(["send-keys", "-t", paneId, "C-u"]);
  sleepMs(80);
  tmux(["send-keys", "-t", paneId, "C-u"]);
  sleepMs(60);
}

function restoreComposerDraft(paneId: string, draft: string): void {
  if (!draft.trim()) return;
  pasteMessage(paneId, draft);
}

/** Cursor-agent paste with bracketed-paste guard. */
function injectCursorAgent(
  paneId: string,
  message: string,
  plan: InjectPlan,
  captureTail: string,
  captureTailAnsi?: string,
): void {
  const liveTail =
    tmux(["capture-pane", "-t", paneId, "-p", "-S", "-14"]).out ?? captureTail;
  const liveAnsi =
    tmux(["capture-pane", "-t", paneId, "-p", "-S", "-14", "-e"]).out ?? captureTailAnsi;
  const bottom = liveTail.split("\n").slice(-14).join("\n");
  const generating = /Working|Running|Thinking|enter steer/.test(bottom);
  const followUp = /Add a follow-up/.test(bottom);
  const rawDraft = coordComposerDraft(liveTail, "cursor-agent", liveAnsi).trim();
  const meshInject = isSmInjectText(message);
  const saved = meshInject
    ? ""
    : humanDraftToPreserve(liveTail, "cursor-agent", message, liveAnsi);
  const staleInjectInComposer = rawDraft.length > 0 && isSmInjectText(rawDraft);

  if (saved) clearComposerDraft(paneId, "cursor-agent", generating);
  else if (meshInject || staleInjectInComposer) {
    // Inbox paste must replace composer — do not splice onto chopped prior inject tail.
    clearComposerDraft(paneId, "cursor-agent", generating);
  } else if (!generating && /→/.test(bottom) && !followUp) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(250);
  }

  pasteMessage(paneId, message);

  if (!plan.skipSubmit) {
    const delayMs = message.length > 400 ? 650 : 450;
    sleepMs(delayMs);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    sleepMs(350);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    sleepMs(200);
    tmux(["send-keys", "-t", paneId, "Enter"]);
  }
  if (saved) {
    sleepMs(200);
    restoreComposerDraft(paneId, saved);
  }
}

/** Claude Code: clear stuck composer draft before paste (else inject is invisible). */
function injectClaude(paneId: string, message: string, plan: InjectPlan, captureTail = ""): void {
  const live = captureTail || tmux(["capture-pane", "-t", paneId, "-p", "-S", "-12"]).out || "";
  const meshInject = isSmInjectText(message);
  const saved = meshInject ? "" : humanDraftToPreserve(live, "claude", message);
  const rawDraft = coordComposerDraft(live, "claude").trim();
  const staleInjectInComposer = rawDraft.length > 0 && isSmInjectText(rawDraft);
  if (plan.flushEscFirst) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(120);
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(150);
  }
  const bottom = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-8"]).out ?? "";
  if (
    saved ||
    meshInject ||
    staleInjectInComposer ||
    /^❯\s/m.test(bottom) ||
    /\n❯\s/m.test(bottom)
  ) {
    tmux(["send-keys", "-t", paneId, "C-u"]);
    sleepMs(80);
    tmux(["send-keys", "-t", paneId, "C-u"]);
    sleepMs(80);
  }
  pasteMessage(paneId, message);
  if (!plan.skipSubmit) {
    sleepMs(plan.enterDelayMs ?? 200);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    sleepMs(400);
    const after = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-6"]).out ?? "";
    if (/Press up to edit queued messages/i.test(after)) {
      tmux(["send-keys", "-t", paneId, "Enter"]);
      sleepMs(300);
    }
  }
  if (saved) {
    sleepMs(150);
    restoreComposerDraft(paneId, saved);
  }
}

/** Direct pane inject (orchestrator path later). */
export function injectToPane(
  paneId: string,
  message: string,
  plan: InjectPlan,
  providerId?: string,
  captureTail = "",
  captureTailAnsi?: string,
): void {
  withPaneInjectLock(paneId, () => {
    sleepMs(150);
    if (providerId === "cursor-agent" || providerId === "agent") {
      injectCursorAgent(paneId, message, plan, captureTail, captureTailAnsi);
      return;
    }

    if (providerId === "claude") {
      injectClaude(paneId, message, plan, captureTail);
      return;
    }

    const meshInject = isSmInjectText(message);
    const saved = meshInject
      ? ""
      : humanDraftToPreserve(captureTail, providerId ?? "", message, captureTailAnsi);
    if (saved || meshInject) clearComposerDraft(paneId, providerId ?? "", false);
    else if (plan.flushEscFirst) {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(120);
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(150);
    }

    pasteMessage(paneId, message);
    sleepMs(plan.enterDelayMs);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    if (saved) {
      sleepMs(150);
      restoreComposerDraft(paneId, saved);
    }
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

import { spawnSync } from "node:child_process";
import type { InjectPlan } from "@seat-mesh/core";
import { withActivePanePreserved } from "../lib/select-pane.js";
import { tmux } from "../lib/tmux-run.js";
import { humanDraftToPreserve } from "./inject-draft.js";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

export function withPaneInputEnabled(paneId: string, fn: () => void): void {
  withActivePanePreserved(paneId, () => {
    const off = tmux(["display-message", "-t", paneId, "-p", "#{pane_input_off}"]).out;
    if (off === "1") {
      tmux(["select-pane", "-e", "-t", paneId]);
    }
    try {
      fn();
    } finally {
      if (off === "1") {
        tmux(["select-pane", "-d", "-t", paneId]);
      }
    }
  });
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
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(120);
    tmux(["send-keys", "-t", paneId, "C-u"]);
    sleepMs(60);
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
  captureTail: string,
  captureTailAnsi?: string,
): void {
  const bottom = captureTail.split("\n").slice(-14).join("\n");
  const generating = /Working|Running|Thinking|enter steer/.test(bottom);
  const followUp = /Add a follow-up/.test(bottom);
  const saved = humanDraftToPreserve(captureTail, "cursor-agent", message, captureTailAnsi);

  if (saved) clearComposerDraft(paneId, "cursor-agent", generating);
  else if (!generating && /→/.test(bottom) && !followUp) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(250);
  }

  pasteMessage(paneId, message);

  const delayMs = message.length > 400 ? 650 : 450;
  sleepMs(delayMs);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  sleepMs(350);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  sleepMs(200);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  if (saved) {
    sleepMs(200);
    restoreComposerDraft(paneId, saved);
  }
}

/** Claude Code: clear stuck composer draft before paste (else inject is invisible). */
function injectClaude(paneId: string, message: string, plan: InjectPlan, captureTail = ""): void {
  const live = captureTail || tmux(["capture-pane", "-t", paneId, "-p", "-S", "-12"]).out || "";
  const saved = humanDraftToPreserve(live, "claude", message);
  if (plan.flushEscFirst) {
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(120);
    tmux(["send-keys", "-t", paneId, "Escape"]);
    sleepMs(150);
  }
  const bottom = tmux(["capture-pane", "-t", paneId, "-p", "-S", "-8"]).out ?? "";
  if (saved || /^❯\s/m.test(bottom) || /\n❯\s/m.test(bottom)) {
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
  withPaneInputEnabled(paneId, () => {
    if (providerId === "cursor-agent" || providerId === "agent") {
      injectCursorAgent(paneId, message, captureTail, captureTailAnsi);
      return;
    }

    if (providerId === "claude") {
      injectClaude(paneId, message, plan, captureTail);
      return;
    }

    const saved = humanDraftToPreserve(captureTail, providerId ?? "", message, captureTailAnsi);
    if (saved) clearComposerDraft(paneId, providerId ?? "", false);
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
  withPaneInputEnabled(paneId, () => {
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

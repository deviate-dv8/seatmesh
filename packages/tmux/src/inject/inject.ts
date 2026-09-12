import { spawnSync } from "node:child_process";
import type { InjectPlan } from "seat-mesh-core";
import { tmux } from "../lib/tmux-run.js";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  spawnSync("sleep", [String(ms / 1000)]);
}

export function withPaneInputEnabled(paneId: string, fn: () => void): void {
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
}

function pasteMessage(paneId: string, message: string): void {
  const loaded = spawnSync("tmux", ["load-buffer", "-"], {
    input: message,
    encoding: "utf8",
  });
  if (loaded.status === 0) {
    const pasted = tmux(["paste-buffer", "-t", paneId, "-d"]);
    if (!pasted.ok) {
      tmux(["send-keys", "-t", paneId, "-l", message]);
    }
  } else {
    tmux(["send-keys", "-t", paneId, "-l", message]);
  }
}

/** Cursor-agent paste with bracketed-paste guard. */
function injectCursorAgent(paneId: string, message: string, captureTail: string): void {
  const bottom = captureTail.split("\n").slice(-14).join("\n");
  const generating = /Working|Running|Thinking|enter steer/.test(bottom);
  const followUp = /Add a follow-up/.test(bottom);

  if (!generating) {
    if (/→/.test(bottom) && !followUp) {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(250);
    }
  }

  pasteMessage(paneId, message);

  const delayMs = message.length > 400 ? 650 : 450;
  sleepMs(delayMs);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  sleepMs(350);
  tmux(["send-keys", "-t", paneId, "Enter"]);
  sleepMs(200);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

/** Direct pane inject (orchestrator path later). */
export function injectToPane(
  paneId: string,
  message: string,
  plan: InjectPlan,
  providerId?: string,
  captureTail = "",
): void {
  withPaneInputEnabled(paneId, () => {
    if (providerId === "cursor-agent" || providerId === "agent") {
      injectCursorAgent(paneId, message, captureTail);
      return;
    }

    if (plan.flushEscFirst) {
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(120);
      tmux(["send-keys", "-t", paneId, "Escape"]);
      sleepMs(150);
    }

    pasteMessage(paneId, message);
    sleepMs(plan.enterDelayMs);
    tmux(["send-keys", "-t", paneId, "Enter"]);
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

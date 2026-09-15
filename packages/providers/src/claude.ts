import type {
  AgentProvider,
  ComposerState,
  Detection,
  InjectPlan,
  LimitContext,
  LimitDetector,
  PaneSnapshot,
} from "@seat-mesh/core";
import {
  claudeInputDraft,
  cmdlines,
  composerFromCapture,
  defaultComposerReady,
  extractUuid,
  matchAny,
  modelFromCmdlines,
  scrapePromptTurnGeneric,
  sessionIdFromDetection,
} from "./shared.js";

const PATTERNS = [/\bclaude\b/, /\/bin\/claude/];

const ccLimitDetector: LimitDetector = {
  id: "cc-limit",
  match(state: ComposerState) {
    return state.phase === "limit" && state.limitKind === "cc-limit";
  },
  async onRisingEdge(ctx: LimitContext) {
    await ctx.enqueue({
      type: "limits.cc-limit",
      paneId: ctx.pane.paneId,
      payload: { providerId: ctx.providerId },
    });
  },
};

export const claudeProvider: AgentProvider = {
  id: "claude",

  detect(pane: PaneSnapshot): Detection | null {
    const lines = cmdlines(pane);
    if (!matchAny(lines, PATTERNS)) return null;
    let resumeId: string | undefined;
    for (const line of lines) {
      resumeId =
        extractUuid(line, ["--resume", "--session-id"]) ?? resumeId;
    }
    return { providerId: "claude", resumeId };
  },

  composerState(pane: PaneSnapshot) {
    return composerFromCapture(pane, "claude");
  },

  composerReady(pane: PaneSnapshot) {
    const tail = pane.captureTail ?? "";
    // Process detect matches the launch cmdline early; wait for TUI chrome.
    if (!/auto mode on|⏵⏵/i.test(tail)) return false;
    if (!/❯/.test(tail)) return false;
    return defaultComposerReady(pane, "claude");
  },

  injectPlan(_pane: PaneSnapshot): InjectPlan {
    return {
      prefix: "",
      useBracketedPaste: false,
      enterDelayMs: 200,
      flushEscFirst: true,
    };
  },

  limits: [ccLimitDetector],

  sessionId(_pane, detection) {
    return sessionIdFromDetection(detection);
  },

  modelId(pane) {
    return modelFromCmdlines(cmdlines(pane), "claude");
  },

  scrapePromptTurn(pane) {
    return scrapePromptTurnGeneric(pane);
  },

  humanDraft(pane: PaneSnapshot): string {
    return claudeInputDraft(pane.captureTail);
  },
};

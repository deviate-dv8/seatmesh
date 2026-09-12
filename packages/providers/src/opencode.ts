import type {
  AgentProvider,
  ComposerState,
  Detection,
  InjectPlan,
  LimitContext,
  LimitDetector,
  PaneSnapshot,
} from "seat-mesh-core";
import {
  cmdlines,
  composerFromCapture,
  extractOpenCodeSession,
  matchAny,
  modelFromCmdlines,
  normalizeOpenCodeSessionId,
  opencodeComposerReady,
  paneStoredOpenCodeSession,
  scrapeOpenCodeSessionFromCapture,
  scrapePromptTurnGeneric,
  sessionIdFromDetection,
} from "./shared.js";

const PATTERNS = [/opencode/];

const ocLimitDetector: LimitDetector = {
  id: "oc-limit",
  match(state: ComposerState) {
    return state.phase === "limit" && state.limitKind === "oc-limit";
  },
  async onRisingEdge(ctx: LimitContext) {
    await ctx.enqueue({
      type: "limits.oc-limit",
      paneId: ctx.pane.paneId,
      payload: { wave: "all-oc-panes" },
    });
  },
};

const ocConnectDetector: LimitDetector = {
  id: "oc-connect",
  match(state: ComposerState) {
    return state.phase === "limit" && state.limitKind === "oc-connect";
  },
  async onRisingEdge(ctx: LimitContext) {
    await ctx.enqueue({
      type: "connectivity.proxy-up",
      paneId: ctx.pane.paneId,
    });
  },
};

export const opencodeProvider: AgentProvider = {
  id: "opencode",

  detect(pane: PaneSnapshot): Detection | null {
    const lines = cmdlines(pane);
    if (!matchAny(lines, PATTERNS)) return null;
    let resumeId: string | undefined;
    for (const line of lines) {
      resumeId = extractOpenCodeSession(line) ?? resumeId;
    }
    if (!resumeId) {
      resumeId = paneStoredOpenCodeSession(pane.options);
    }
    if (!resumeId) {
      resumeId = scrapeOpenCodeSessionFromCapture(pane.captureTail);
    }
    resumeId = normalizeOpenCodeSessionId(resumeId);
    return { providerId: "opencode", resumeId };
  },

  composerState(pane: PaneSnapshot) {
    return composerFromCapture(pane, "opencode");
  },

  composerReady(pane: PaneSnapshot) {
    return opencodeComposerReady(pane);
  },

  injectPlan(_pane: PaneSnapshot): InjectPlan {
    return {
      prefix: "",
      useBracketedPaste: false,
      enterDelayMs: 150,
      flushEscFirst: true,
    };
  },

  limits: [ocLimitDetector, ocConnectDetector],

  sessionId(_pane, detection) {
    return sessionIdFromDetection(detection);
  },

  modelId(pane) {
    return modelFromCmdlines(cmdlines(pane), "opencode");
  },

  scrapePromptTurn(pane) {
    return scrapePromptTurnGeneric(pane);
  },
};

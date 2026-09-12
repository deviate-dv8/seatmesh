/**
 * Agent provider contract — orchestrator uses registry only (no CLI if/else).
 */

export interface PaneSnapshot {
  paneId: string;
  windowName: string;
  cwd: string;
  currentCommand: string;
  captureTail: string;
  options: Record<string, string>;
}

export type ComposerPhase =
  | "empty"
  | "typing"
  | "busy"
  | "afk"
  | "limit"
  | "plain_shell";

export interface ComposerState {
  phase: ComposerPhase;
  limitKind?: string;
  draftFingerprint?: string;
  busyLabel?: string;
}

export interface Detection {
  providerId: string;
  resumeId?: string;
}

export interface InjectPlan {
  /** Prefix before message body (empty for OpenCode mesh text). */
  prefix: string;
  useBracketedPaste: boolean;
  enterDelayMs: number;
  flushEscFirst: boolean;
}

export interface LimitContext {
  pane: PaneSnapshot;
  providerId: string;
  state: ComposerState;
  profileName: string;
  enqueue: (job: LimitJob) => Promise<void>;
}

export interface LimitJob {
  type: string;
  paneId?: string;
  payload?: Record<string, unknown>;
}

export interface LimitDetector {
  id: string;
  match(state: ComposerState, pane: PaneSnapshot): boolean;
  onRisingEdge(ctx: LimitContext): Promise<void>;
}

/** One human prompt + agent reply pair (queryable; not pane scrollback). */
export interface PromptCapture {
  humanPrompt: string;
  agentResponse: string;
}

/**
 * Per-slot prompt log (CHAT.jsonl) — required on every AgentProvider.
 * Lets manager/secretary query session/model/prompt/response without scraping panes.
 */
export interface PromptRecording {
  /** CLI session / resume id for grouping turns (may be undefined for stateless CLIs). */
  sessionId(pane: PaneSnapshot, detection: Detection): string | undefined;
  /** Model label when known (cmdline flag, footer, or provider default). */
  modelId(pane: PaneSnapshot): string | undefined;
  /**
   * Scrape latest completed exchange from pane capture.
   * Return null when not parseable — use explicit `chat append` or inject-time record.
   */
  scrapePromptTurn(pane: PaneSnapshot): PromptCapture | null;
}

export interface AgentProvider extends PromptRecording {
  id: string;
  detect(pane: PaneSnapshot): Detection | null;
  composerState(pane: PaneSnapshot): ComposerState;
  /** True when the CLI composer accepts a paste (splash done, not generating). */
  composerReady(pane: PaneSnapshot): boolean;
  injectPlan(pane: PaneSnapshot): InjectPlan;
  limits?: LimitDetector[];
}

export interface ProviderRegistry {
  register(provider: AgentProvider): void;
  detect(pane: PaneSnapshot): AgentProvider | null;
  get(id: string): AgentProvider | undefined;
  all(): AgentProvider[];
}

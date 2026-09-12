import fs from "node:fs";
import path from "node:path";

export interface PpaPaneState {
  label: string;
  paneId: string;
  agent: string;
  border: string;
  composer: string;
  idleS: number;
  updatedAt: string;
}

export interface PpaStateFile {
  updatedAt: string;
  panes: Record<string, PpaPaneState>;
}

const IDLE_PHASES = new Set(["empty", "idle", "afk", "plain_shell"]);

function isIdlePhase(phase: string): boolean {
  return IDLE_PHASES.has(phase);
}

function isIdleComposer(composer: string): boolean {
  const phase = composer.split(":")[0] ?? composer;
  return isIdlePhase(phase);
}

export class PpaStateStore {
  private readonly filePath: string;
  private state: PpaStateFile;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "ppa-state.json");
    this.state = this.load();
  }

  private load(): PpaStateFile {
    if (!fs.existsSync(this.filePath)) {
      return { updatedAt: new Date(0).toISOString(), panes: {} };
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PpaStateFile;
    } catch {
      return { updatedAt: new Date(0).toISOString(), panes: {} };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2) + "\n");
  }

  /** Called from border paint when a pane is sampled. */
  touch(input: {
    paneId: string;
    label: string;
    agent: string;
    border: string;
    composerPhase: string;
    composerLabel: string;
    nowMs?: number;
  }): void {
    const nowMs = input.nowMs ?? Date.now();
    const composer = `${input.composerPhase}${input.composerLabel ? `:${input.composerLabel}` : ""}`;
    const prev = this.state.panes[input.paneId];
    let idleS = 0;
    if (isIdlePhase(input.composerPhase)) {
      if (prev && isIdleComposer(prev.composer)) {
        const prevUpdated = Date.parse(prev.updatedAt);
        const delta = Number.isFinite(prevUpdated)
          ? Math.max(0, Math.floor((nowMs - prevUpdated) / 1000))
          : 0;
        idleS = prev.idleS + delta;
      }
    }

    this.state.panes[input.paneId] = {
      label: input.label,
      paneId: input.paneId,
      agent: input.agent,
      border: input.border,
      composer,
      idleS,
      updatedAt: new Date(nowMs).toISOString(),
    };
    this.state.updatedAt = new Date(nowMs).toISOString();
    this.save();
  }

  snapshot(): PpaPaneState[] {
    return Object.values(this.state.panes).sort((a, b) => a.label.localeCompare(b.label));
  }
}

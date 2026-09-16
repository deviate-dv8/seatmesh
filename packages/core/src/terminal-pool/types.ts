export type TpJobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

/** Durable shell job — runs off agent panes; results peer only to requester. */
export interface TpJobRow {
  id: string;
  at: string;
  /** Seat label at submit (slot-1, manager, mini-3, …). */
  requesterSeat: string;
  /** Tmux pane id (%N) — sole delivery target for stdout summary. */
  requesterPane: string;
  cmd: string;
  cwd?: string;
  summary?: string;
  status: TpJobStatus;
  /** PTY pool job — agent can attach for stdin (default true on submit). */
  interactive?: boolean;
  /** Assigned pool worker 0..N-1 while running. */
  workerId?: number;
  exitCode?: number;
  stdoutPath?: string;
  stderrPath?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export type TpWorkerStatus = "idle" | "running";

export interface TpWorkerSnapshot {
  workerId: number;
  status: TpWorkerStatus;
  jobId?: string;
  requesterSeat?: string;
  cmd?: string;
  summary?: string;
  attachBusy?: boolean;
}

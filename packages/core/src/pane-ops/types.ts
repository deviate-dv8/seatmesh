export type PaneOpKind =
  | "launch"
  | "switch"
  | "relayout"
  | "mini-spawn"
  | "mini-spawn-all"
  | "secretary-dispatch"
  | "secretary-restart";

export type PaneOpStatus = "pending" | "running" | "done" | "failed";

export interface PaneOpRow {
  id: string;
  at: string;
  kind: PaneOpKind;
  who: string;
  summary: string;
  payload: Record<string, unknown>;
  status: PaneOpStatus;
  error?: string;
  finishedAt?: string;
}

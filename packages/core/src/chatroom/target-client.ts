import { spawnSync } from "node:child_process";
import ky from "ky";
import { parseTargetDeadline } from "./eod.js";

export interface TargetEntry {
  id: string;
  status: "active" | "done" | "cancelled";
  goal: string;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
  kind?: "scope" | "slice";
  parentId?: string;
  remindedAt?: string;
  triageAt?: string;
  triageTo?: string[];
  source?: string;
}

export interface AddTargetInput {
  inboxBase: string;
  goal: string;
  /** eod (default) | ISO | duration */
  deadline?: string;
  triageTo?: string[];
  /** Whole-operator goal for leads to break down. */
  kind?: "scope" | "slice";
  /** Parent scope id when adding a slice. */
  parentId?: string;
}

function inboxClient(base: string) {
  return ky.create({
    prefix: base.replace(/\/$/, ""),
    timeout: 5_000,
    retry: { limit: 0 },
  });
}

export function addTarget(input: AddTargetInput): Promise<{ ok: boolean; id?: string; error?: string; target?: TargetEntry }> {
  const goal = input.goal.trim();
  if (!goal) return Promise.resolve({ ok: false, error: "goal required" });
  const parsed = parseTargetDeadline(input.deadline, new Date());
  if (!parsed.ok) return Promise.resolve({ ok: false, error: parsed.error });
  const payload = {
    goal,
    deadlineAt: parsed.deadlineAt,
    triageTo: input.triageTo,
    kind: input.kind,
    parentId: input.parentId,
  };
  return (async () => {
    try {
      const json = (await inboxClient(input.inboxBase).post("targets", { json: payload }).json()) as {
        ok?: boolean;
        id?: string;
        target?: TargetEntry;
        error?: string;
      };
      if (!json.ok) return { ok: false, error: json.error ?? "rejected" };
      return { ok: true, id: json.id, target: json.target };
    } catch (e) {
      const err = e as { response?: Response; message?: string };
      if (err.response) {
        const text = await err.response.text().catch(() => "");
        return { ok: false, error: `inbox POST ${err.response.status}: ${text.slice(0, 200)}` };
      }
      return { ok: false, error: err.message ?? String(e) };
    }
  })();
}

export function addTargetSync(input: AddTargetInput): { ok: boolean; id?: string; error?: string; target?: TargetEntry } {
  const goal = input.goal.trim();
  if (!goal) return { ok: false, error: "goal required" };
  const parsed = parseTargetDeadline(input.deadline, new Date());
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const payload = JSON.stringify({
    goal,
    deadlineAt: parsed.deadlineAt,
    triageTo: input.triageTo,
    kind: input.kind,
    parentId: input.parentId,
  });
  const base = input.inboxBase.replace(/\/$/, "");
  const r = spawnSync(
    "curl",
    ["-sS", "-m", "5", "-X", "POST", `${base}/targets`, "-H", "content-type: application/json", "-d", payload],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || "curl failed").trim().slice(0, 200) };
  try {
    const json = JSON.parse(r.stdout || "{}") as {
      ok?: boolean;
      id?: string;
      target?: TargetEntry;
      error?: string;
    };
    if (!json.ok) return { ok: false, error: json.error ?? "rejected" };
    return { ok: true, id: json.id, target: json.target };
  } catch {
    return { ok: false, error: `bad response: ${(r.stdout || "").slice(0, 120)}` };
  }
}

export async function listTargets(
  inboxBase: string,
  opts?: { all?: boolean },
): Promise<TargetEntry[]> {
  const q = opts?.all ? "?all=1" : "";
  try {
    const json = (await inboxClient(inboxBase).get(`targets${q}`).json()) as {
      targets?: TargetEntry[];
    };
    return json.targets ?? [];
  } catch {
    return [];
  }
}

export function listTargetsSync(inboxBase: string, opts?: { all?: boolean }): TargetEntry[] {
  const q = opts?.all ? "?all=1" : "";
  const base = inboxBase.replace(/\/$/, "");
  const r = spawnSync("curl", ["-sS", "-m", "5", `${base}/targets${q}`], { encoding: "utf8" });
  if (r.status !== 0) return [];
  try {
    const json = JSON.parse(r.stdout || "{}") as { targets?: TargetEntry[] };
    return json.targets ?? [];
  } catch {
    return [];
  }
}

async function postTargetAction(
  inboxBase: string,
  id: string,
  action: "done" | "cancel" | "triage" | "remind",
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const json = (await inboxClient(inboxBase)
      .post(`targets/${encodeURIComponent(id)}/${action}`, { json: body ?? {} })
      .json()) as { ok?: boolean; error?: string };
    if (!json.ok) return { ok: false, error: json.error ?? "rejected" };
    return { ok: true };
  } catch (e) {
    const err = e as { response?: Response; message?: string };
    if (err.response) {
      const text = await err.response.text().catch(() => "");
      return { ok: false, error: `inbox POST ${err.response.status}: ${text.slice(0, 200)}` };
    }
    return { ok: false, error: err.message ?? String(e) };
  }
}

export function targetDone(inboxBase: string, id: string) {
  return postTargetAction(inboxBase, id, "done");
}
export function targetCancel(inboxBase: string, id: string) {
  return postTargetAction(inboxBase, id, "cancel");
}
export function targetTriage(inboxBase: string, id: string, triageTo?: string[]) {
  return postTargetAction(inboxBase, id, "triage", triageTo ? { triageTo } : {});
}
export function targetRemind(inboxBase: string, id: string) {
  return postTargetAction(inboxBase, id, "remind");
}

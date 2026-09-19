import { spawnSync } from "node:child_process";
import ky from "ky";
import { expiresAtUtcFromDuration, parseDurationToSeconds } from "./duration.js";

export interface ArmCheckbackInput {
  inboxBase: string;
  ownerPane: string;
  expect: string;
  duration: string;
  renew?: string;
  kind?: string;
  /** Stable id so todo check can cancel the matching CB. */
  id?: string;
  senderPane?: string;
  ownerMini?: string | number | null;
  ownerSlot?: string | number | null;
  /** Seat label for session-scoped retarget (mini-N / slot-N / role). */
  recipientLabel?: string;
  ownerLabel?: string;
}

export interface ArmCheckbackResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  response?: unknown;
  /** The armed checkback's id (from the daemon's response entry), when ok. */
  id?: string;
}

function inboxClient(base: string) {
  return ky.create({
    prefix: base.replace(/\/$/, ""),
    timeout: 5_000,
    retry: { limit: 0 },
  });
}

/** Arm inbox checkback (poll-later). Default on comms so agents keep working instead of human POV chat-wait. */
export async function armCheckback(input: ArmCheckbackInput): Promise<ArmCheckbackResult> {
  if (!input.ownerPane) {
    return { ok: false, reason: "no owner pane (--here / tmux pane required)" };
  }

  const expiresAt = expiresAtUtcFromDuration(input.duration);
  if (!expiresAt) {
    return { ok: false, reason: `bad duration: ${input.duration}` };
  }

  let renewSec: number | null = null;
  if (input.renew) {
    renewSec = parseDurationToSeconds(input.renew);
    if (renewSec == null) {
      return { ok: false, reason: `bad renew: ${input.renew}` };
    }
  }

  const payload = {
    expect: input.expect,
    ownerPane: input.ownerPane,
    expiresAt,
    kind: input.kind ?? "comms",
    renewSec,
    ownerMini: input.ownerMini != null && String(input.ownerMini) !== "" ? input.ownerMini : null,
    ownerSlot: input.ownerSlot != null && String(input.ownerSlot) !== "" ? input.ownerSlot : null,
    senderPane: input.senderPane ?? null,
    recipientLabel: input.recipientLabel ?? null,
    ownerLabel: input.ownerLabel ?? input.recipientLabel ?? null,
    ...(input.id ? { id: input.id } : {}),
  };

  try {
    const json = await inboxClient(input.inboxBase).post("patience", { json: payload }).json();
    const entryId = (json as { entry?: { id?: string } } | undefined)?.entry?.id;
    return { ok: true, response: json, id: entryId };
  } catch (e) {
    const err = e as { response?: Response; message?: string };
    if (err.response) {
      const text = await err.response.text().catch(() => "");
      return { ok: false, reason: `inbox POST ${err.response.status}: ${text.slice(0, 200)}` };
    }
    return { ok: false, reason: err.message ?? String(e) };
  }
}

/** Sync arm — CLI send paths must not exit before the timer is posted. */
export function armCheckbackSync(input: ArmCheckbackInput): ArmCheckbackResult {
  if (!input.ownerPane) {
    return { ok: false, reason: "no owner pane (--here / tmux pane required)" };
  }
  const expiresAt = expiresAtUtcFromDuration(input.duration);
  if (!expiresAt) {
    return { ok: false, reason: `bad duration: ${input.duration}` };
  }
  let renewSec: number | null = null;
  if (input.renew) {
    renewSec = parseDurationToSeconds(input.renew);
    if (renewSec == null) {
      return { ok: false, reason: `bad renew: ${input.renew}` };
    }
  }
  const payload = {
    id: input.id,
    expect: input.expect,
    ownerPane: input.ownerPane,
    expiresAt,
    kind: input.kind ?? "comms",
    renewSec,
    ownerMini: input.ownerMini != null && String(input.ownerMini) !== "" ? input.ownerMini : null,
    ownerSlot: input.ownerSlot != null && String(input.ownerSlot) !== "" ? input.ownerSlot : null,
    senderPane: input.senderPane ?? null,
    recipientLabel: input.recipientLabel ?? null,
    ownerLabel: input.ownerLabel ?? input.recipientLabel ?? null,
  };
  const base = input.inboxBase.replace(/\/$/, "");
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "5",
      "-X",
      "POST",
      `${base}/patience`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(payload),
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    return { ok: false, reason: r.stderr?.trim() || r.stdout?.trim() || "curl patience failed" };
  }
  return { ok: true, response: r.stdout };
}

/** Sync cancel by id — used when a todo is checked done. */
export function cancelCheckbackSync(
  inboxBase: string,
  id: string,
): { ok: boolean; reason?: string } {
  const base = inboxBase.replace(/\/$/, "");
  const encoded = encodeURIComponent(id);
  const r = spawnSync(
    "curl",
    ["-sS", "-m", "5", "-X", "POST", `${base}/patience/${encoded}/cancel`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    return { ok: false, reason: r.stderr?.trim() || r.stdout?.trim() || "curl cancel failed" };
  }
  try {
    const j = JSON.parse(r.stdout || "{}") as { ok?: boolean };
    return { ok: j.ok !== false };
  } catch {
    return { ok: true };
  }
}

export async function inboxHealthy(inboxBase: string): Promise<boolean> {
  try {
    await inboxClient(inboxBase).get("health");
    return true;
  } catch {
    return false;
  }
}

export interface CheckbackEntry {
  id: string;
  kind: string;
  status: "active" | "cancelled";
  renewSec?: number;
  expect?: string;
  ownerPane?: string;
  expiresAt?: string;
  senderLabel?: string;
  recipientLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listCheckbacks(
  inboxBase: string,
  opts: { all?: boolean } = {},
): Promise<{ entries: CheckbackEntry[] }> {
  const url = opts.all ? "patience?all=1" : "patience";
  return inboxClient(inboxBase).get(url).json<{ entries: CheckbackEntry[] }>();
}

export interface CancelCheckbackResult {
  ok: boolean;
  cancelled: string | null;
  error?: string;
}

export async function cancelCheckback(
  inboxBase: string,
  id: string,
): Promise<CancelCheckbackResult> {
  const encoded = encodeURIComponent(id);
  try {
    return await inboxClient(inboxBase)
      .post(`patience/${encoded}/cancel`)
      .json<CancelCheckbackResult>();
  } catch (e) {
    const err = e as { response?: Response; message?: string };
    if (err.response) {
      try {
        const body = (await err.response.json()) as CancelCheckbackResult;
        if (body && typeof body.ok === "boolean") return body;
      } catch {
        /* fall through */
      }
      return {
        ok: false,
        cancelled: null,
        error: `inbox POST ${err.response.status}`,
      };
    }
    return { ok: false, cancelled: null, error: err.message ?? String(e) };
  }
}

export interface CancelAllCheckbacksResult {
  ok: boolean;
  cancelled: number;
}

export async function cancelAllCheckbacks(
  inboxBase: string,
): Promise<CancelAllCheckbacksResult> {
  return inboxClient(inboxBase)
    .post("patience/cancel-all")
    .json<CancelAllCheckbacksResult>();
}

export interface ResetCheckbackResult {
  ok: boolean;
  entry?: CheckbackEntry;
  error?: string;
}

export async function resetCheckback(
  inboxBase: string,
  id: string,
  expiresAt: string,
): Promise<ResetCheckbackResult> {
  const encoded = encodeURIComponent(id);
  try {
    return await inboxClient(inboxBase)
      .post(`patience/${encoded}/reset`, { json: { expiresAt } })
      .json<ResetCheckbackResult>();
  } catch (e) {
    const err = e as { response?: Response; message?: string };
    if (err.response) {
      const text = await err.response.text().catch(() => "");
      return { ok: false, error: `inbox POST ${err.response.status}: ${text.slice(0, 200)}` };
    }
    return { ok: false, error: err.message ?? String(e) };
  }
}

export interface AckCheckbackResult {
  ok: boolean;
  action?: string;
  id?: string;
  error?: string;
}

export async function ackCheckback(
  inboxBase: string,
  id: string,
  yes: boolean,
): Promise<AckCheckbackResult> {
  try {
    return await inboxClient(inboxBase)
      .post("patience/ack", { json: { id, yes } })
      .json<AckCheckbackResult>();
  } catch (e) {
    const err = e as { response?: Response; message?: string };
    if (err.response) {
      const text = await err.response.text().catch(() => "");
      return { ok: false, error: `inbox POST ${err.response.status}: ${text.slice(0, 200)}` };
    }
    return { ok: false, error: err.message ?? String(e) };
  }
}

export interface ClearAckEndedResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Close an ACK row after a peer reply (`peer … --ended <id>`).
 * Sync curl so the CLI does not exit before the ledger clears.
 */
export function clearAckEndedSync(
  inboxBase: string,
  id: string,
  note: string,
): ClearAckEndedResult {
  const base = inboxBase.replace(/\/$/, "");
  const payload = JSON.stringify({
    id: String(id || "").trim(),
    note: String(note || "").trim().slice(0, 200) || "peer --ended",
  });
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-m",
      "5",
      "-X",
      "POST",
      `${base}/ack`,
      "-H",
      "Content-Type: application/json",
      "-d",
      payload,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    return { ok: false, error: r.stderr?.trim() || r.stdout?.trim() || "curl /ack failed" };
  }
  try {
    const json = JSON.parse(r.stdout || "{}") as {
      ok?: boolean;
      entry?: { id?: string };
      error?: string;
    };
    if (!json.ok) return { ok: false, error: json.error ?? "ack clear failed" };
    return { ok: true, id: json.entry?.id };
  } catch {
    return { ok: false, error: `bad /ack response: ${(r.stdout || "").slice(0, 120)}` };
  }
}

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
  senderPane?: string;
  ownerMini?: string | number | null;
  ownerSlot?: string | number | null;
}

export interface ArmCheckbackResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  response?: unknown;
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
  };

  try {
    const json = await inboxClient(input.inboxBase).post("patience", { json: payload }).json();
    return { ok: true, response: json };
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
    expect: input.expect,
    ownerPane: input.ownerPane,
    expiresAt,
    kind: input.kind ?? "comms",
    renewSec,
    ownerMini: input.ownerMini != null && String(input.ownerMini) !== "" ? input.ownerMini : null,
    ownerSlot: input.ownerSlot != null && String(input.ownerSlot) !== "" ? input.ownerSlot : null,
    senderPane: input.senderPane ?? null,
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
  cancelled: string;
}

export async function cancelCheckback(
  inboxBase: string,
  id: string,
): Promise<CancelCheckbackResult> {
  const encoded = encodeURIComponent(id);
  return inboxClient(inboxBase)
    .post(`patience/${encoded}/cancel`)
    .json<CancelCheckbackResult>();
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

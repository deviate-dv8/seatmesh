import type { LoadedProfile } from "@seat-mesh/core";
import type {
  NotifyActLink,
  NotifyActRegisterAction,
  NotifyActType,
} from "@seat-mesh/core";
import { resolvePaneTarget } from "@seat-mesh/tmux";
import type { PeerKind, PeerRow } from "../store/jsonl-store.js";

export interface NotifyActStore {
  resolveInbox(input: { id?: string; all?: boolean }): { resolved: number; ids: string[] };
  ackCheckback(id: string, yes: boolean): { ok: boolean; id?: string; action?: string; error?: string };
  appendPeer(row: PeerRow): void;
}

export interface NotifyActTokenRow {
  token: string;
  label: string;
  type: NotifyActType;
  params: Record<string, unknown>;
  expiresAt: number;
  used: boolean;
}

export interface NotifyActExecuteCtx {
  loaded: LoadedProfile;
  store: NotifyActStore;
  log: (line: string) => void;
  onPeerEnqueued: (row: PeerRow) => void | Promise<void>;
}

export function createNotifyActRegistry() {
  const tokens = new Map<string, NotifyActTokenRow>();

  function pruneExpired(): void {
    const now = Date.now();
    for (const [id, row] of tokens) {
      if (row.expiresAt <= now || row.used) tokens.delete(id);
    }
  }

  function register(
    actions: NotifyActRegisterAction[],
    ttlSec: number,
    baseUrl: string,
  ): NotifyActLink[] {
    pruneExpired();
    const ttl = Math.min(Math.max(ttlSec, 60), 86_400);
    const base = baseUrl.replace(/\/$/, "");
    const links: NotifyActLink[] = [];
    const expiresAt = Date.now() + ttl * 1000;
    for (const a of actions) {
      const label = String(a.label ?? "").trim();
      if (!label) continue;
      const token = crypto.randomUUID();
      tokens.set(token, {
        token,
        label,
        type: a.type,
        params: a.params ?? {},
        expiresAt,
        used: false,
      });
      links.push({ label, token, url: `${base}/act/v1/${token}` });
    }
    return links;
  }

  function take(token: string): NotifyActTokenRow | null {
    pruneExpired();
    const row = tokens.get(token);
    if (!row || row.used || row.expiresAt <= Date.now()) return null;
    row.used = true;
    tokens.delete(token);
    return row;
  }

  return { register, take, pruneExpired };
}

export type NotifyActRegistry = ReturnType<typeof createNotifyActRegistry>;

export async function executeNotifyAct(
  row: NotifyActTokenRow,
  ctx: NotifyActExecuteCtx,
): Promise<{ ok: boolean; summary: string }> {
  switch (row.type) {
    case "ping":
      ctx.log(`NOTIFY-ACT ping label=${row.label}`);
      return { ok: true, summary: "Recorded (no mesh mutation)." };
    case "inbox-resolve": {
      const id = row.params.id != null ? String(row.params.id) : undefined;
      const all = row.params.all === true;
      const result = ctx.store.resolveInbox({ id, all });
      ctx.log(`NOTIFY-ACT inbox-resolve count=${result.resolved}`);
      return {
        ok: true,
        summary: `Resolved ${result.resolved} inbox row(s).`,
      };
    }
    case "checkback-ack": {
      const id = String(row.params.id ?? "").trim();
      if (!id) return { ok: false, summary: "Missing checkback id." };
      const yes =
        row.params.yes === true ||
        row.params.yes === "true" ||
        String(row.params.answer ?? "").toLowerCase() === "yes";
      const result = ctx.store.ackCheckback(id, yes);
      if (!result.ok) return { ok: false, summary: result.error ?? "Ack failed." };
      ctx.log(`NOTIFY-ACT checkback-ack id=${result.id} action=${result.action}`);
      return { ok: true, summary: `Checkback ${result.action}.` };
    }
    case "peer": {
      const target = String(row.params.target ?? "manager").trim();
      const msg = String(row.params.msg ?? "").trim();
      if (!msg) return { ok: false, summary: "Empty peer message." };
      const resolved = resolvePaneTarget(target, ctx.loaded);
      if ("error" in resolved) {
        return { ok: false, summary: resolved.error };
      }
      const kindRaw = String(row.params.kind ?? "prompt");
      const kind: PeerKind =
        kindRaw === "to-mini" ||
        kindRaw === "to-slot" ||
        kindRaw === "remind" ||
        kindRaw === "room"
          ? kindRaw
          : "prompt";
      const now = new Date().toISOString();
      const peer: PeerRow = {
        id: crypto.randomUUID(),
        at: now,
        kind,
        fromSlot: "notify-act",
        fromPorts: null,
        targetPane: resolved.paneId,
        targetLabel: resolved.row.slot || target,
        msg,
        sent: false,
      };
      ctx.store.appendPeer(peer);
      ctx.log(`NOTIFY-ACT peer -> ${peer.targetLabel} :: ${msg.slice(0, 80)}`);
      await ctx.onPeerEnqueued(peer);
      return {
        ok: true,
        summary: `Queued peer to ${peer.targetLabel} (${target}): ${msg.slice(0, 120)}`,
      };
    }
    default:
      return { ok: false, summary: `Unknown action type.` };
  }
}

export function htmlActPage(title: string, body: string, ok: boolean): string {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const color = ok ? "#2e7d32" : "#c62828";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:40rem;line-height:1.45}
h1{color:${color};font-size:1.25rem}a.btn{display:inline-block;margin-top:1rem;padding:.5rem 1rem;
background:#1565c0;color:#fff;border-radius:6px;text-decoration:none;font-weight:600}</style>
</head><body><h1>${safeTitle}</h1><p>${safeBody}</p>
<a class="btn" href="/ui">Back to mesh UI</a>
<p><small>seatmesh notify-act · one-shot</small></p></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

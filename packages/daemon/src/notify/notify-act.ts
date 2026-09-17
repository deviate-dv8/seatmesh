import type {
  NotifyActCard,
  NotifyActLink,
  NotifyActRegisterAction,
  NotifyActType,
} from "@seat-mesh/core";
import type { LoadedProfile } from "@seat-mesh/core";
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

export interface NotifyActCardRow {
  id: string;
  title: string;
  body: string;
  links: NotifyActLink[];
  expiresAt: number;
}

export interface NotifyActExecuteCtx {
  loaded: LoadedProfile;
  store: NotifyActStore;
  log: (line: string) => void;
  onPeerEnqueued: (row: PeerRow) => void | Promise<void>;
}

export function createNotifyActRegistry() {
  const tokens = new Map<string, NotifyActTokenRow>();
  const cards = new Map<string, NotifyActCardRow>();

  function pruneExpired(): void {
    const now = Date.now();
    for (const [id, row] of tokens) {
      if (row.expiresAt <= now || row.used) tokens.delete(id);
    }
    for (const [id, row] of cards) {
      if (row.expiresAt <= now) cards.delete(id);
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

  function registerCard(
    input: { title: string; body: string; links: NotifyActLink[] },
    ttlSec: number,
    /**
     * Browser-facing card URL base (operator hub). Prefer hubActCardUrl via
     * `infoUrl` override; string form is `${base}/act/card/${id}`.
     */
    cardBaseOrInfoUrl: string | { infoUrl: (id: string) => string },
  ): NotifyActCard {
    pruneExpired();
    const ttl = Math.min(Math.max(ttlSec, 60), 86_400);
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + ttl * 1000;
    const row: NotifyActCardRow = {
      id,
      title: input.title.trim() || "Decision",
      body: input.body.trim(),
      links: input.links,
      expiresAt,
    };
    cards.set(id, row);
    const infoUrl =
      typeof cardBaseOrInfoUrl === "string"
        ? `${cardBaseOrInfoUrl.replace(/\/$/, "")}/act/card/${id}`
        : cardBaseOrInfoUrl.infoUrl(id);
    return {
      id,
      title: row.title,
      body: row.body,
      infoUrl,
      links: row.links,
      expiresAt,
    };
  }

  function getCard(id: string): NotifyActCardRow | null {
    pruneExpired();
    const row = cards.get(id);
    if (!row || row.expiresAt <= Date.now()) return null;
    return row;
  }

  /**
   * After card id is known, stamp peer Yes/No msgs with card=/info=/session=
   * so mesh-inbox PRIORITY lines are greppable (not title-only).
   */
  function annotatePeerMsgsWithCard(input: {
    cardId: string;
    infoUrl: string;
    session?: string;
  }): void {
    const cardId = input.cardId.trim();
    const infoUrl = input.infoUrl.trim();
    if (!cardId) return;
    for (const row of tokens.values()) {
      if (row.type !== "peer") continue;
      const msg = String(row.params.msg ?? "");
      if (!/\[operator-decide\]/i.test(msg)) continue;
      if (/\bcard=/.test(msg)) continue;
      const lines = [msg.trimEnd(), `card=${cardId}`];
      if (infoUrl) lines.push(`info=${infoUrl}`);
      const target = String(row.params.target ?? "").trim();
      if (target) lines.push(`target=${target}`);
      const session = input.session?.trim();
      if (session) lines.push(`session=${session}`);
      row.params.msg = lines.join("\n");
    }
  }

  function take(token: string): NotifyActTokenRow | null {
    pruneExpired();
    const row = tokens.get(token);
    if (!row || row.used || row.expiresAt <= Date.now()) return null;
    row.used = true;
    tokens.delete(token);
    return row;
  }

  return { register, registerCard, getCard, annotatePeerMsgsWithCard, take, pruneExpired };
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
        fromSlot: "operator",
        fromAgent: "operator",
        fromPorts: null,
        targetPane: resolved.paneId,
        targetLabel: resolved.row.slot?.startsWith("mini-")
          ? resolved.row.slot
          : resolved.row.slot && /^\d+$/.test(resolved.row.slot)
            ? `slot-${resolved.row.slot}`
            : resolved.row.slot || target,
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

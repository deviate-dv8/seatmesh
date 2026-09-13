import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { meshRuntimePaths, type LoadedProfile } from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { capturePaneSnapshot } from "../lib/snapshot.js";

export const SENT_TOKEN_RE = /\[sent:([a-z0-9]+)\]/i;

export interface PromptSentProof {
  ok: boolean;
  token: string;
  paneId: string;
  via?: "pane-row" | "scrollback" | "queued";
  last?: string;
}

export interface PeerDeliverRow {
  id?: string;
  sent?: boolean;
  sentAt?: string;
  deliverPane?: string;
  targetPane?: string;
  holdReason?: string;
  msg?: string;
}

function sleepMs(ms: number): void {
  if (ms > 0) spawnSync("sleep", [String(ms / 1000)]);
}

export function stampSentToken(msg: string): { body: string; token: string } {
  const existing = SENT_TOKEN_RE.exec(msg);
  if (existing?.[1]) return { body: msg, token: existing[1] };
  const token = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { body: `${msg.trimEnd()}\n[sent:${token}]`, token };
}

export function isRealDeliverPane(
  deliverPane: string | undefined,
  targetPane: string,
): boolean {
  return Boolean(
    deliverPane &&
      targetPane.startsWith("%") &&
      deliverPane === targetPane,
  );
}

export function peerRowSentProof(
  row: PeerDeliverRow | undefined,
  targetPane: string,
): boolean {
  if (!row?.sent || !row.sentAt) return false;
  if (row.deliverPane === "backlog" || row.deliverPane === "skipped") return false;
  return isRealDeliverPane(row.deliverPane, targetPane);
}

export function readPeerRows(loaded: LoadedProfile): PeerDeliverRow[] {
  const file = meshRuntimePaths(loaded).peerJsonl;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as PeerDeliverRow;
      } catch {
        return null;
      }
    })
    .filter((r): r is PeerDeliverRow => r != null);
}

function findPeerRow(
  loaded: LoadedProfile,
  opts: { mailId?: string; token: string; paneId: string },
): PeerDeliverRow | undefined {
  const rows = readPeerRows(loaded);
  if (opts.mailId) {
    const byId = rows.find((r) => r.id === opts.mailId);
    if (byId) return byId;
  }
  return [...rows]
    .reverse()
    .find(
      (r) =>
        (r.msg ?? "").includes(`[sent:${opts.token}]`) &&
        r.targetPane === opts.paneId,
    );
}

/** Wait until daemon parked (FAIL) or injected into the real pane / token in scrollback. */
export function waitPromptSent(
  loaded: LoadedProfile,
  opts: {
    paneId: string;
    token: string;
    mailId?: string;
    timeoutMs?: number;
  },
): PromptSentProof {
  // Short default: busy targets should QUEUED fast; settle inject still has ~1.5s.
  const timeoutMs = opts.timeoutMs ?? 4_000;
  const start = Date.now();
  let last = "pending";
  const registry = createRegistryForProfile(loaded.profile);
  while (Date.now() - start < timeoutMs) {
    const snap = capturePaneSnapshot(opts.paneId);
    const tail = snap?.captureTail ?? "";
    if (tail.includes(`[sent:${opts.token}]`) || tail.includes(opts.token)) {
      return { ok: true, token: opts.token, paneId: opts.paneId, via: "scrollback" };
    }
    // Target not deliverable — do not burn the full timeout (overdelayed CLI).
    if (snap && Date.now() - start >= 800) {
      const prov = registry.detect(snap);
      const phase = prov?.composerState(snap).phase ?? "plain_shell";
      if (
        phase === "busy" ||
        phase === "plain_shell" ||
        phase === "limit" ||
        phase === "typing"
      ) {
        return {
          ok: true,
          token: opts.token,
          paneId: opts.paneId,
          via: "queued",
          last: `held:${phase}`,
        };
      }
    }
    const row = findPeerRow(loaded, opts);
    if (row) {
      if (row.deliverPane === "backlog") {
        return {
          ok: true,
          token: opts.token,
          paneId: opts.paneId,
          via: "queued",
          last: row.holdReason ?? "held until pane idle",
        };
      }
      if (row.deliverPane === "skipped") {
        return {
          ok: false,
          token: opts.token,
          paneId: opts.paneId,
          last: "skipped",
        };
      }
      if (peerRowSentProof(row, opts.paneId)) {
        return { ok: true, token: opts.token, paneId: opts.paneId, via: "pane-row" };
      }
      const hold = row.holdReason ?? "";
      const elapsed = Date.now() - start;
      if (
        elapsed >= 800 &&
        /held:(busy|plain_shell|limit|no_provider|coord:wait-busy|coord:wait-typing)/.test(
          hold,
        )
      ) {
        return {
          ok: true,
          token: opts.token,
          paneId: opts.paneId,
          via: "queued",
          last: hold || "held until pane idle",
        };
      }
      // After settle window with no pane/scrollback proof — QUEUED (daemon still
      // injecting). Avoids 4–10s CLI stalls while lead peers wait for SENT.
      if (elapsed >= 1600 && !peerRowSentProof(row, opts.paneId)) {
        return {
          ok: true,
          token: opts.token,
          paneId: opts.paneId,
          via: "queued",
          last: hold || last || "pending inject",
        };
      }
      last = `pending deliverPane=${row.deliverPane ?? "-"} hold=${hold || "-"}`;
    }
    sleepMs(200);
  }
  // Timeout: durable queue is success (not FAIL). Prefer QUEUED only when we
  // never saw inject proof — caller prints QUEUED vs SENT from via.
  const row = findPeerRow(loaded, opts);
  if (row?.deliverPane === "backlog") {
    return {
      ok: true,
      token: opts.token,
      paneId: opts.paneId,
      via: "queued",
      last: row.holdReason ?? "held until pane idle",
    };
  }
  if (row && !peerRowSentProof(row, opts.paneId)) {
    return {
      ok: true,
      token: opts.token,
      paneId: opts.paneId,
      via: "queued",
      last: last || `pending deliverPane=${row.deliverPane ?? "-"}`,
    };
  }
  return { ok: false, token: opts.token, paneId: opts.paneId, last };
}

export function formatPromptSent(label: string, proof: PromptSentProof): string {
  if (proof.ok && proof.via === "queued") {
    return `QUEUED: ${label} pane=${proof.paneId} token=${proof.token} — inbox will inject when idle (${proof.last ?? "backlog"})`;
  }
  if (proof.ok) {
    return `SENT: ${label} pane=${proof.paneId} token=${proof.token} via=${proof.via}`;
  }
  return `FAIL: not sent ${label} pane=${proof.paneId} token=${proof.token} last=${proof.last ?? "?"}`;
}

import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import {
  formatWorkerInjectStamp,
  isAckClassPeer,
  peerTargetForComms,
  portsForSlot,
  resolveAgentId,
} from "@seat-mesh/core";
import { createRegistryForProfile } from "@seat-mesh/providers";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { paneMetaForPane } from "../lib/pane-meta.js";
import { injectToPane } from "./inject.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";
import { isInboxUp, warnBypassComms } from "../comms/bypass-comms.js";
import { armAfterPeer } from "../comms/chat-checkback.js";
import { runWhoami } from "../agents/whoami.js";
import { stampSentToken, waitPromptSent } from "./prompt-sent.js";

export interface PromptOptions {
  /** Prefix with manager coordination tag. */
  manager?: boolean;
  /** Override prefix (empty string = none). */
  prefix?: string;
  /** Post-launch / POV: inject even if composer looks like typing (Claude tip draft). */
  force?: boolean;
  /** Default true. POV/cold-start may skip pane prove. */
  confirmSent?: boolean;
  /** Default true on enqueue / manager inject. */
  armCheckback?: boolean;
  /** Pre-built body (skips buildPromptBody); bypass enqueue uses from/to header. */
  bodyOverride?: string;
}

function commsIdentity(
  loaded: LoadedProfile,
  paneId: string,
  row: { role: string; slot?: string | null; mini?: string | null },
): { agentId: string; peerTarget: string } {
  const meta = paneMetaForPane(paneId);
  const miniRaw = row.mini ?? meta?.mini ?? null;
  const mini =
    miniRaw != null && String(miniRaw).length > 0 ? String(miniRaw) : null;
  const slotNum = row.slot ? Number(row.slot) : meta?.slot ? Number(meta.slot) : null;
  const input = {
    role: row.role,
    slot: slotNum != null && Number.isFinite(slotNum) ? slotNum : null,
    mini,
  };
  return {
    agentId: resolveAgentId(input),
    peerTarget: peerTargetForComms(input),
  };
}

export function buildPromptBody(
  loaded: LoadedProfile,
  text: string,
  opts: PromptOptions = {},
): string {
  let prefix = "";
  if (opts.prefix !== undefined) {
    prefix = opts.prefix;
  } else if (opts.manager) {
    prefix = `${loaded.profile.daemon.managerPromptPrefix} `;
  }
  let body = prefix + text;
  // FYI/PASS/progress must not demand a peer reply — that footer is the n+1 loop.
  if (isAckClassPeer(body)) {
    if (!/\bno reply required\b/i.test(body)) {
      body += `\nFYI — no reply required (operator owns next instruction)`;
    }
    return body;
  }
  if (
    !/\bReply: (?:\.\/sm\.sh )?peer /.test(body) &&
    !/\breply (?:\.\/sm\.sh )?peer /.test(body) &&
    !/\bReply: seatmesh agent (?:ack|peer) /.test(body)
  ) {
    try {
      const w = runWhoami(loaded, "here");
      if (w.paneId) {
        const resolved = resolvePaneTarget("here", loaded);
        if (!("error" in resolved)) {
          const id = commsIdentity(loaded, resolved.paneId, resolved.row);
          body += `\nClose: seatmesh agent ack <id> | ack reply <id> "ACK" | peer ${id.peerTarget} --ack`;
        }
      }
    } catch {
      body += `\nClose: seatmesh agent ack <id>`;
    }
  }
  return body;
}

function steeringHeader(loaded: LoadedProfile, paneId: string, row: { role: string; slot?: string | null; mini?: string | null }): string {
  const meta = paneMetaForPane(paneId);
  const slotNum = row.slot ? Number(row.slot) : meta?.slot ? Number(meta.slot) : null;
  const ports =
    meta?.ports?.trim() ||
    (slotNum != null && Number.isFinite(slotNum)
      ? portsForSlot(loaded.profile.ports.worker, slotNum)
      : undefined);
  const ctx = {
    role: row.role,
    slot: slotNum && Number.isFinite(slotNum) ? slotNum : null,
    mini: row.mini ?? meta?.mini ?? null,
    ports: ports ?? meta?.ports ?? null,
    workerCount: loaded.profile.session.workerCount,
    miniMax: loaded.profile.session.miniMax,
  };
  return `${formatWorkerInjectStamp(ctx)} `;
}

/** Explicit "from -> to" so a recipient never has to guess who a peer message is from. */
function fromToHeader(
  loaded: LoadedProfile,
  targetPaneId: string,
  targetRow: { role: string; slot?: string | null; mini?: string | null },
): string {
  const to = commsIdentity(loaded, targetPaneId, targetRow);
  let fromAgent = "manager";
  try {
    const here = resolvePaneTarget("here", loaded);
    if (!("error" in here)) {
      fromAgent = commsIdentity(loaded, here.paneId, here.row).agentId;
    }
  } catch {
    /* keep manager */
  }
  return `[from:${fromAgent} to:${to.peerTarget}] `;
}

/** Enqueue manager/worker prompt (daemon injects when target idle). */
export function enqueuePrompt(
  loaded: LoadedProfile,
  target: string,
  text: string,
  opts: PromptOptions = {},
): { paneId: string; targetLabel: string; token?: string; via?: string } {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  const targetLabel =
    resolved.row.role === "worker" && resolved.row.slot != null
      ? `slot-${resolved.row.slot}`
      : resolved.row.role === "manager-mini" && resolved.row.mini != null
        ? `mini-${resolved.row.mini}`
        : target;

  const fullBody =
    fromToHeader(loaded, resolved.paneId, resolved.row) + buildPromptBody(loaded, text, opts);
  const stamped = stampSentToken(fullBody);

  // Progress/FYI must not arm a checkback that nags the sender for a coord reply.
  const armCb = opts.armCheckback !== false && !isAckClassPeer(text);

  if (!isInboxUp(loaded)) {
    warnBypassComms(targetLabel, "prompt");
    const registry = createRegistryForProfile(loaded.profile);
    const direct = injectPromptDirect(loaded, registry, target, text, {
      ...opts,
      force: true,
      confirmSent: false,
      bodyOverride: fullBody,
    });
    if (armCb) {
      armAfterPeer(loaded, target, { pane: process.env.TMUX_PANE });
    }
    return {
      paneId: direct.paneId,
      targetLabel,
      token: direct.token,
      via: "bypass",
    };
  }

  const resp = enqueuePeer(loaded, {
    kind: "prompt",
    msg: stamped.body,
    targetPane: resolved.paneId,
    targetLabel,
    fromSlot: "manager",
  });
  if (!resp?.ok) {
    warnBypassComms(targetLabel, "prompt enqueue failed");
    const registry = createRegistryForProfile(loaded.profile);
    const direct = injectPromptDirect(loaded, registry, target, text, {
      ...opts,
      force: true,
      confirmSent: false,
      bodyOverride: fullBody,
    });
    if (armCb) {
      armAfterPeer(loaded, target, { pane: process.env.TMUX_PANE });
    }
    return {
      paneId: direct.paneId,
      targetLabel,
      token: direct.token,
      via: "bypass",
    };
  }
  const entry = resp.entry as { id?: string } | undefined;
  const proof = waitPromptSent(loaded, {
    paneId: resolved.paneId,
    token: stamped.token,
    mailId: entry?.id,
  });
  if (!proof.ok) {
    throw new Error(
      `FAIL: prompt not sent -> ${targetLabel} pane=${resolved.paneId} token=${stamped.token} last=${proof.last ?? "?"}`,
    );
  }

  if (armCb && proof.via !== "queued") {
    armAfterPeer(loaded, target, { pane: process.env.TMUX_PANE });
  }

  return {
    paneId: resolved.paneId,
    targetLabel,
    token: stamped.token,
    via: proof.via,
  };
}

/**
 * Direct inject — migration exception for handoff/mini spawn until those flip to enqueue.
 * Only daemon-owned paths should call inject long-term.
 */
export function injectPromptDirect(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  text: string,
  opts: PromptOptions = {},
): { paneId: string; providerId: string; token?: string; via?: string } {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  const snap = capturePaneSnapshot(resolved.paneId);
  if (!snap) throw new Error(`cannot capture pane ${resolved.paneId}`);

  const provider = registry.detect(snap);
  if (!provider) {
    throw new Error(
      `no live agent CLI in ${resolved.paneId} — run seatmesh --profile .sm launch ${target} first`,
    );
  }

  const state = provider.composerState(snap);
  if (state.phase === "plain_shell") {
    throw new Error(`pane ${resolved.paneId} is plain shell — launch a CLI first`);
  }
  if (!opts.force && (state.phase === "typing" || state.phase === "busy")) {
    throw new Error(
      `pane ${resolved.paneId} composer phase=${state.phase} — clear draft or wait; use seatmesh --profile .sm agent room say -r managers or seat QUEUE.md`,
    );
  }
  if (!opts.force && (provider.id === "claude" || provider.id === "cursor-agent")) {
    const ready =
      provider.composerReady?.(snap) ??
      (state.phase === "empty" || state.phase === "afk");
    if (!ready) {
      throw new Error(
        `pane ${resolved.paneId} composer not ready — no inject (room/QUEUE coord instead)`,
      );
    }
  }

  const stamped = stampSentToken(opts.bodyOverride ?? buildPromptBody(loaded, text, opts));
  const plan = provider.injectPlan(snap);
  injectToPane(
    resolved.paneId,
    stamped.body,
    plan,
    provider.id,
    snap.captureTail,
    snap.captureTailAnsi,
  );
  if (opts.confirmSent === false) {
    return {
      paneId: resolved.paneId,
      providerId: provider.id,
      token: stamped.token,
    };
  }
  const proof = waitPromptSent(loaded, {
    paneId: resolved.paneId,
    token: stamped.token,
    timeoutMs: 6000,
  });
  if (!proof.ok) {
    throw new Error(
      `FAIL: prompt not sent -> ${target} pane=${resolved.paneId} token=${stamped.token} last=${proof.last ?? "?"}`,
    );
  }

  const armCbDirect = opts.armCheckback !== false && !isAckClassPeer(text);
  if (armCbDirect) {
    armAfterPeer(loaded, target, { pane: process.env.TMUX_PANE });
  }

  return {
    paneId: resolved.paneId,
    providerId: provider.id,
    token: stamped.token,
    via: proof.via,
  };
}

/** @deprecated Use enqueuePrompt (CLI) or injectPromptDirect (handoff/mini). */
export function runPrompt(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  text: string,
  opts: PromptOptions = {},
): { paneId: string; providerId: string } {
  return injectPromptDirect(loaded, registry, target, text, opts);
}

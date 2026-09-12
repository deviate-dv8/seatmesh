import type { LoadedProfile, ProviderRegistry } from "@seat-mesh/core";
import { formatWorkerInjectStamp, portsForSlot } from "@seat-mesh/core";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { paneMetaForPane } from "../lib/pane-meta.js";
import { injectToPane } from "./inject.js";
import { enqueuePeer } from "../comms/inbox-bridge.js";

export interface PromptOptions {
  /** Prefix with manager coordination tag. */
  manager?: boolean;
  /** Override prefix (empty string = none). */
  prefix?: string;
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
  return prefix + text;
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

/** Enqueue manager/worker prompt (daemon injects when target idle). */
export function enqueuePrompt(
  loaded: LoadedProfile,
  target: string,
  text: string,
  opts: PromptOptions = {},
): { paneId: string; targetLabel: string } {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  let body = buildPromptBody(loaded, text, opts);
  body = steeringHeader(loaded, resolved.paneId, resolved.row) + body;
  const targetLabel =
    resolved.row.role === "worker" && resolved.row.slot != null
      ? `slot-${resolved.row.slot}`
      : resolved.row.role === "manager-mini" && resolved.row.mini != null
        ? `mini-${resolved.row.mini}`
        : target;

  const resp = enqueuePeer(loaded, {
    kind: "prompt",
    msg: body,
    targetPane: resolved.paneId,
    targetLabel,
    fromSlot: "manager",
  });
  if (!resp?.ok) {
    throw new Error("FAIL: prompt enqueue (inbox down?) — run: ./sm.sh inbox restart");
  }

  return { paneId: resolved.paneId, targetLabel };
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
): { paneId: string; providerId: string } {
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  const snap = capturePaneSnapshot(resolved.paneId);
  if (!snap) throw new Error(`cannot capture pane ${resolved.paneId}`);

  const provider = registry.detect(snap);
  if (!provider) {
    throw new Error(
      `no live agent CLI in ${resolved.paneId} — run ./sm.sh launch ${target} first`,
    );
  }

  const state = provider.composerState(snap);
  if (state.phase === "plain_shell") {
    throw new Error(`pane ${resolved.paneId} is plain shell — launch a CLI first`);
  }

  const body = buildPromptBody(loaded, text, opts);
  const plan = provider.injectPlan(snap);
  injectToPane(resolved.paneId, body, plan, provider.id, snap.captureTail);

  return { paneId: resolved.paneId, providerId: provider.id };
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

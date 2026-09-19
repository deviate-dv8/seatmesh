/**
 * `sm schedule <target> "<msg...>" --at <time>` — delayed one-shot peer (TODO 2.5).
 * Queues like any peer message, but the daemon holds it out of drain
 * (`pendingPeerRows`, `notBefore`) until `--at` passes. Fire-and-forget by design
 * (no ACK tracking opens until it's actually delivered) — consistent with moving
 * away from manager-mediated ACK/ACK loops for routine status/reminders.
 */
import { Command } from "commander";
import { enqueuePeer, resolvePaneTarget, runWhoami } from "@seat-mesh/tmux";
import { expiresAtUtcFromDuration, resolveAgentId, type LoadedProfile } from "@seat-mesh/core";

/** Absolute ISO/parseable date, or a relative duration ("10m", "2h", "1d"). */
export function resolveScheduleAt(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate) && asDate > Date.now()) {
    return new Date(asDate).toISOString();
  }
  return expiresAtUtcFromDuration(trimmed);
}

function resolveFrom(loaded: LoadedProfile): { fromSlot: string; fromAgent: string | null } {
  try {
    const w = runWhoami(loaded, "here");
    return { fromSlot: w.slot != null ? String(w.slot) : "?", fromAgent: resolveAgentId(w) };
  } catch {
    return { fromSlot: "operator", fromAgent: "operator" };
  }
}

export function buildScheduleCommand(getLoaded: () => LoadedProfile): Command {
  const schedule = new Command("schedule").description(
    "Delayed one-shot peer — queues now, delivers once --at passes",
  );

  schedule
    .argument("<target>", "manager|secretary|slot-N|mini-N|pane")
    .argument("<msg...>", "message text")
    .requiredOption("--at <time>", "ISO time, or relative duration (10m, 2h, 1d)")
    .action(async (target: string, msgParts: string[], opts: { at: string }) => {
      const loaded = getLoaded();
      const msg = msgParts.join(" ").trim();
      if (!msg) {
        console.error("schedule: message required");
        process.exit(2);
      }
      const notBefore = resolveScheduleAt(opts.at);
      if (!notBefore) {
        console.error(`schedule: bad --at "${opts.at}" (ISO time or duration like 10m/2h/1d)`);
        process.exit(2);
      }
      const resolved = resolvePaneTarget(target, loaded);
      if ("error" in resolved) {
        console.error(`schedule: ${resolved.error}`);
        process.exit(1);
      }
      const { fromSlot, fromAgent } = resolveFrom(loaded);
      const entry = enqueuePeer(loaded, {
        kind: "prompt",
        msg,
        targetPane: resolved.paneId,
        targetLabel: target,
        fromSlot,
        fromAgent,
        notBefore,
      });
      if (!entry) {
        console.error("schedule: enqueue failed (inbox down?)");
        process.exit(1);
      }
      const ms = Date.parse(notBefore) - Date.now();
      const mins = Math.round(ms / 60_000);
      console.log(`OK: scheduled -> ${target} at ${notBefore} (in ~${mins}m)`);
    });

  return schedule;
}

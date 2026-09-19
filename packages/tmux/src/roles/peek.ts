import { spawnSync } from "node:child_process";
import { appendNavEntry, type LoadedProfile, type ProviderRegistry } from "@seat-mesh/core";
import { composerFromCapture } from "@seat-mesh/providers";
import { resolvePaneTarget } from "../lib/resolve-pane.js";
import { capturePaneSnapshot } from "../lib/snapshot.js";
import { bannerNameFromMeta } from "../session/borders.js";
import { readSeatSnapshot } from "../seats/seat-update.js";

function tmux(args: string[]): string | null {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout ?? "").trimEnd();
}

function captureFull(paneId: string): string {
  return tmux(["capture-pane", "-t", paneId, "-p", "-S", "-"]) ?? "";
}

function opt(snap: { options: Record<string, string> }, key: string): string {
  return snap.options[key] ?? "";
}

export function runPeek(
  loaded: LoadedProfile,
  registry: ProviderRegistry,
  target: string,
  mode: "status" | "full",
): void {
  const session = loaded.sessionName;
  const resolved = resolvePaneTarget(target, loaded);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const { paneId, row } = resolved;
  void appendNavEntry(loaded, {
    actor: process.env.TMUX_PANE ? "agent" : "operator",
    target,
    targetPane: paneId,
    role: row.role,
    slot: row.slot,
  });

  if (mode === "full") {
    const text = captureFull(paneId);
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
    return;
  }

  const snap = capturePaneSnapshot(paneId);
  if (!snap) {
    throw new Error(`peek: could not read pane ${paneId}`);
  }

  const prov = registry.detect(snap);
  const providerId = prov?.id ?? "unknown";
  const det = prov?.detect(snap);
  const composer = composerFromCapture(snap, providerId);

  const role = opt(snap, "mesh_role") || row.role || "?";
  const slot = opt(snap, "mesh_slot") || row.slot || "-";
  const mini = opt(snap, "mesh_mini") || row.mini || "";
  const ports = opt(snap, "mesh_ports") || row.ports || "-";
  const title = opt(snap, "mesh_title") || "";
  const border = opt(snap, "mesh_status") || "";

  const lines = [
    `pane=${paneId} window=${snap.windowName} role=${role} slot=${slot} ports=${ports}`,
    `cmd=${snap.currentCommand || "?"}`,
    `cwd=${snap.cwd || "?"}`,
    `provider=${providerId}${det?.resumeId ? ` resume=${det.resumeId}` : ""}`,
    `composer=${composer.phase}${composer.busyLabel ? `:${composer.busyLabel}` : ""}${composer.limitKind ? `:${composer.limitKind}` : ""}`,
  ];
  if (title) lines.push(`title=${title}`);
  if (border) lines.push(`border=${border}`);
  const banner = [
    opt(snap, "mesh_name") || bannerNameFromMeta({ role, slot: slot === "-" ? "" : slot, mini }),
    opt(snap, "mesh_tasks"),
    opt(snap, "mesh_inbox"),
    opt(snap, "mesh_checkbacks"),
    opt(snap, "mesh_status") || border,
  ].filter(Boolean);
  if (banner.length) lines.push(`banner=${banner.join(" | ")}`);
  if (composer.draftFingerprint) lines.push(`draft=${composer.draftFingerprint}`);

  // composer=empty means "nothing typed right now", NOT "no work queued" — surface
  // the seat's actual TASKS.md count too, else an idle composer reads as no task.
  const seatSnap = readSeatSnapshot(loaded, {
    role,
    slot: slot === "-" ? null : slot,
    mini: mini || null,
  });
  if (seatSnap) {
    lines.push(
      `tasks=${seatSnap.tasks.open} open (${seatSnap.tasks.done} done) mark=${seatSnap.focus.mark ?? "?"}`,
    );
  }

  const tailLines = snap.captureTail.split("\n").filter((l) => l.trim());
  const preview = tailLines.slice(-6).join("\n");
  if (preview) {
    lines.push("--- tail ---");
    lines.push(preview);
  }

  console.log(lines.join("\n"));
}

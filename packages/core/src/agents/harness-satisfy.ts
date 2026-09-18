import type { PaneSnapshot } from "../providers/types.js";
import type { ResolvedAgentKind } from "./kinds.js";
import { lookupResolvedKind } from "./kinds.js";
import { normalizeAgentKind } from "./runners.js";

export interface ProveEvidence {
  cmdlines?: string[];
  resumeCmd?: string | null;
  /** Pane capture / options for soft UI-live checks */
  snap?: PaneSnapshot | null;
}

function anyRegexMatch(patterns: string[] | undefined, haystacks: string[]): boolean {
  if (!patterns?.length || !haystacks.length) return false;
  for (const p of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(p, "i");
    } catch {
      continue;
    }
    if (haystacks.some((h) => re.test(h))) return true;
  }
  return false;
}

/** True when kind.prove matches cmdline and/or resumeCmd evidence. */
export function kindProveMatches(kind: ResolvedAgentKind, evidence: ProveEvidence): boolean {
  const prove = kind.prove;
  if (!prove) return false;
  const lines = evidence.cmdlines ?? [];
  if (prove.cmdline?.length && anyRegexMatch(prove.cmdline, lines)) return true;
  if (prove.resumeCmd?.length && evidence.resumeCmd) {
    if (anyRegexMatch(prove.resumeCmd, [evidence.resumeCmd])) return true;
  }
  return false;
}

/** Soft: OpenCode TUI looks live (used when seat is configured for a prove-kind). */
export function openCodeUiLive(snap: PaneSnapshot | null | undefined): boolean {
  if (!snap) return false;
  if (snap.options?.mesh_oc_session?.trim()) return true;
  return /ctrl\+p commands|Build auto\s+·|OpenCode\s+\d/i.test(snap.captureTail ?? "");
}

function providerToHarnessId(providerId: string): string {
  if (providerId === "cursor-agent") return "agent";
  return providerId;
}

/**
 * Label the live harness using detect + saved type + prove evidence.
 * Prefer a prove-matching kind over bare provider id (CPE OC detects as opencode).
 */
export function resolveLiveHarnessKind(input: {
  detectId?: string | null;
  savedType?: string | null;
  resumeCmd?: string | null;
  cmdlines?: string[];
  snap?: PaneSnapshot | null;
  kinds?: Record<string, ResolvedAgentKind>;
}): string {
  const detect = input.detectId ?? "empty";
  const kinds = input.kinds;

  if (detect && detect !== "opencode" && detect !== "empty") {
    return providerToHarnessId(detect);
  }

  const evidence: ProveEvidence = {
    cmdlines: input.cmdlines,
    resumeCmd: input.resumeCmd,
    snap: input.snap,
  };

  if (kinds) {
    // Prefer explicit saved kind if it has prove and evidence (or soft UI+saved)
    if (input.savedType) {
      const saved = lookupResolvedKind(kinds, input.savedType);
      if (saved?.prove) {
        if (kindProveMatches(saved, evidence)) return saved.id;
        // Soft UI without prove → base provider label (not prove-kind).
        // Returning saved.id here made liveType===wantedType and skipped atomics kill.
        if (saved.satisfy?.whenProvider === "opencode" && openCodeUiLive(input.snap)) {
          return "opencode";
        }
      } else if (saved && input.savedType !== "opencode") {
        // Non-prove extension with saved type wins when detect is opencode/empty
        if (detect === "opencode" || detect === "empty") return saved.id;
      }
    }
    // Any prove-kind matching cmdline/resume
    for (const kind of Object.values(kinds)) {
      if (kind.prove && kindProveMatches(kind, evidence)) return kind.id;
    }
  } else {
    // No kinds map — legacy CPE heuristics (prove only — not savedType alone)
    if (
      (input.resumeCmd && /opencode-cpe\.sh/i.test(input.resumeCmd)) ||
      (input.cmdlines?.some((l) => /opencode-cpe\.sh|HTTPS_PROXY=.*18887|HTTP_PROXY=.*18887/i.test(l)) ??
        false)
    ) {
      return "opencode-cpe";
    }
  }

  if (detect === "opencode") return "opencode";
  return detect || "empty";
}

/**
 * True when live pane already satisfies wanted kind — do not kill/relaunch.
 */
export function liveKindSatisfiesWanted(
  liveType: string,
  wantedType: string,
  evidence: ProveEvidence,
  kinds?: Record<string, ResolvedAgentKind>,
  opts?: { savedType?: string | null; resumeCmd?: string | null },
): boolean {
  if (!wantedType || wantedType === "empty") return liveType === "empty";
  if (liveType === wantedType) return true;

  const wanted = kinds ? lookupResolvedKind(kinds, wantedType) : undefined;

  if (wanted?.satisfy) {
    const when = wanted.satisfy.whenProvider;
    const liveAsProvider =
      liveType === when ||
      (when === "opencode" && liveType === "opencode") ||
      (when === "cursor-agent" && liveType === "agent");
    if (when && (liveAsProvider || liveType === when)) {
      const ev: ProveEvidence = {
        ...evidence,
        resumeCmd: opts?.resumeCmd ?? evidence.resumeCmd,
      };
      if (wanted.satisfy.requireProve) {
        if (kindProveMatches(wanted, ev)) return true;
        // Soft: resumeCmd itself is the CPE wrapper (child may be bare `opencode` under proxy).
        // Do NOT soft-accept on savedType alone — that blocked atomics kill after type→opencode-cpe.
        if (
          opts?.resumeCmd != null &&
          kindProveMatches(wanted, { resumeCmd: opts.resumeCmd }) &&
          when === "opencode" &&
          openCodeUiLive(evidence.snap)
        ) {
          return true;
        }
        return false;
      }
      return true;
    }
  }

  // Legacy without kinds map
  if (!kinds && wantedType === "opencode-cpe" && liveType === "opencode") {
    const cmdlines = evidence.cmdlines ?? [];
    if (cmdlines.some((l) => /opencode-cpe\.sh|HTTPS_PROXY=.*18887/i.test(l))) return true;
    if (
      opts?.resumeCmd != null &&
      /opencode-cpe\.sh/i.test(opts.resumeCmd) &&
      openCodeUiLive(evidence.snap)
    ) {
      return true;
    }
  }

  // Wanted bare family must not accept a prove-extension live label
  if (wanted && !wanted.prove && liveType !== wantedType) {
    const liveKind = kinds ? lookupResolvedKind(kinds, liveType) : undefined;
    if (liveKind?.prove && liveKind.provider === wanted.provider) return false;
  }
  if (!kinds && wantedType === "opencode" && liveType === "opencode-cpe") {
    return false;
  }

  return false;
}

/** Seats whose kind opts into proxy-up / CPE revive waves. */
export function kindWantsProxyRecovery(kind: ResolvedAgentKind | undefined): boolean {
  return Boolean(kind?.recovery?.onProxyUp);
}

export function entryWantsProxyRecovery(
  entry: { type?: string | null; resume_cmd?: string | null; resumeCmd?: string | null } | null,
  kinds: Record<string, ResolvedAgentKind>,
): boolean {
  if (!entry) return false;
  const type = entry.type ?? "";
  const resume = entry.resume_cmd ?? entry.resumeCmd ?? null;
  const byType =
    (type ? lookupResolvedKind(kinds, type) : undefined) ??
    (type ? kinds[normalizeAgentKind(type)] : undefined);
  if (kindWantsProxyRecovery(byType)) return true;
  for (const kind of Object.values(kinds)) {
    if (!kind.recovery?.onProxyUp) continue;
    if (resume && kindProveMatches(kind, { resumeCmd: resume })) return true;
  }
  return false;
}

/** True when resumeCmd matches any kind's prove.resumeCmd / prove.cmdline patterns. */
export function resumeCmdMatchesKindProve(
  cmd: string | null | undefined,
  kinds: Record<string, ResolvedAgentKind>,
): boolean {
  if (!cmd) return false;
  for (const kind of Object.values(kinds)) {
    if (kind.prove && kindProveMatches(kind, { resumeCmd: cmd, cmdlines: [cmd] })) return true;
  }
  return false;
}

/**
 * OpenCode family: provider === opencode when kinds known; else legacy id check.
 */
export function isOpenCodeFamilyKind(
  kindRaw: string | null | undefined,
  kinds?: Record<string, ResolvedAgentKind>,
): boolean {
  if (!kindRaw) return false;
  if (kinds) {
    const k = lookupResolvedKind(kinds, kindRaw);
    return k?.provider === "opencode";
  }
  const x = kindRaw.trim().toLowerCase().replace(/_/g, "-");
  return (
    x === "opencode" ||
    x === "opencode-cpe" ||
    x === "oc" ||
    x === "oc-proxy" ||
    x === "ocproxy"
  );
}

export function continueCopyForKind(
  kind: ResolvedAgentKind | undefined,
  fallback: string,
): string {
  return kind?.recovery?.continueCopy?.trim() || fallback;
}

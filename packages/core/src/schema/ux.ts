import { z } from "zod";

/** Where to read pane capture text for a rule match. */
export const UxScanSchema = z
  .object({
    /** Last N lines of capture (default for most limit/busy rules). */
    tailLines: z.number().int().min(1).max(500).optional(),
    /** Bottom N non-empty lines (OpenCode composer footer heuristics). */
    bottomLines: z.number().int().min(1).max(100).optional(),
    /** Entire capture tail. */
    full: z.boolean().optional(),
  })
  .optional();

export const UxWhenSchema = z.object({
  scan: UxScanSchema,
  /** Regex tested against the scanned region (case-insensitive). */
  match: z.string().min(1),
  /** If this regex matches, rule is skipped (e.g. exclude rate-limit when testing connect). */
  unless: z.string().optional(),
});

export const UxStatusSchema = z.object({
  phase: z.enum(["empty", "typing", "busy", "afk", "limit", "plain_shell"]),
  /** limitKind when phase=limit; busyLabel when phase=busy (unless capture set). */
  kind: z.string().optional(),
  /** Border strip label; {kind} expands to kind or busyLabel. */
  border: z.string().optional(),
  busyLabel: z.string().optional(),
  /** Regex capture group index for kind/busyLabel when phase is limit/busy. */
  capture: z.number().int().min(1).max(9).optional(),
});

export const UxTriggerSchema = z.enum([
  "none",
  "connectivity.rate-limit",
  "connectivity.proxy-down",
  "limits.oc-limit",
  "limits.cc-limit",
]);

export const UxRuleSchema = z.object({
  id: z.string().min(1),
  /** Provider ids, or "*" for any detected provider. */
  for: z.array(z.string()).default(["*"]),
  /** Higher runs first; first match wins. */
  priority: z.number().int().default(50),
  when: UxWhenSchema,
  set: UxStatusSchema,
  /** Daemon rising-edge side effect when this limit state appears. */
  onRise: UxTriggerSchema.optional(),
});

export const UxSchema = z.object({
  /** Merge engine defaults before user rules. */
  useDefaults: z.boolean().default(true),
  rules: z.array(UxRuleSchema).default([]),
});

export type UxConfig = z.infer<typeof UxSchema>;
export type UxRule = z.infer<typeof UxRuleSchema>;
export type UxWhen = z.infer<typeof UxWhenSchema>;
export type UxStatus = z.infer<typeof UxStatusSchema>;
export type UxTrigger = z.infer<typeof UxTriggerSchema>;

import { z } from "zod";

/**
 * Mesh-owned slot state file (`mesh-agents.json`).
 *
 * Replaces legacy `tmux-main-agents.json` as the source of truth for
 * which CLI type / resume id each slot runs. Written by save/auto, set, tag,
 * and switch-side scrape; profile yaml is fallback only.
 *
 * Field convention: camelCase (not snake_case). The legacy harness
 * format uses `resume_id`; mesh-agents.json normalises to `resumeId`.
 *
 * Slot mapping (same as slot/types.ts):
 *   manager  - base column 0
 *   secretary - base column 1
 *   workers  - window "workers", 3x2 grid, slots 1-6
 *   minis    - window "minis", 4x2 grid, minis 1-8
 */

export const CliTypeSchema = z.enum([
  "agent",
  "claude",
  "kiro",
  "opencode",
  "empty",
]);

export type CliType = z.infer<typeof CliTypeSchema>;

// -- Slot sub-schemas --------------------------------------------------

export const WorkerSlotSchema = z.object({
  type: CliTypeSchema.default("empty"),
  /** Human-readable label shown in borders/title. */
  name: z.string().optional(),
  /** Workspace resume id (Cursor session / Claude session etc). */
  resumeId: z.string().nullable().optional(),
  /** Full resume command as pasted by launch (overrides buildAgentLaunchCmd). */
  resumeCmd: z.string().nullable().optional(),
  /** Port pair e.g. "3030/3031". */
  ports: z.string().optional(),
  /** Pane index within the workers tmux window (0-based). */
  paneIndex: z.number().int().min(0).optional(),
  /** 1-based slot number for lookup. */
  slot: z.number().int().min(1).max(32),
});

export type WorkerSlot = z.infer<typeof WorkerSlotSchema>;

export const ManagerSlotSchema = z.object({
  type: CliTypeSchema.default("empty"),
  name: z.string().optional(),
  resumeId: z.string().nullable().optional(),
  resumeCmd: z.string().nullable().optional(),
});

export type ManagerSlot = z.infer<typeof ManagerSlotSchema>;

export const SecretarySlotSchema = z.object({
  type: CliTypeSchema.default("opencode"),
  wanted: z.boolean().default(true),
  resumeId: z.string().nullable().optional(),
  resumeCmd: z.string().nullable().optional(),
  ports: z.string().optional(),
  paneIndex: z.number().int().min(0).optional(),
});

export type SecretarySlot = z.infer<typeof SecretarySlotSchema>;

export const MiniSlotSchema = z.object({
  type: CliTypeSchema.default("empty"),
  name: z.string().optional(),
  resumeId: z.string().nullable().optional(),
  resumeCmd: z.string().nullable().optional(),
  /** 1-based mini number (1-8). */
  mini: z.number().int().min(1).max(16),
  /** "helper", "tester", etc -- passed via spawn --role. */
  role: z.string().optional(),
  /** Task description assigned at spawn. */
  task: z.string().optional(),
  /** Pane index within the minis tmux window (0-based). */
  paneIndex: z.number().int().min(0).optional(),
});

export type MiniSlot = z.infer<typeof MiniSlotSchema>;

// -- Conventions (defaults for secretary / mini CLI type) ---------------

export const CoordSyncPolicySchema = z
  .object({
    reload: z.boolean().optional(),
    attach: z.boolean().optional(),
  })
  .optional();

export const ConventionsSchema = z
  .object({
    secretaryDefaultCli: CliTypeSchema.default("opencode"),
    miniDefaultCli: CliTypeSchema.default("opencode"),
    /** Skip empty seats when launching. */
    launchSkipsEmpty: z.boolean().default(true),
    /** Overrides profile layout.base.coordSync when set in mesh-agents.json. */
    coordSync: CoordSyncPolicySchema,
  })
  .default({});

/** Persisted minis window layout (overrides profile yaml when present). */
export const SavedMinisLayoutSchema = z.object({
  grid: z.string().regex(/^\d+x\d+$/),
  max: z.number().int().min(1).max(16),
  leads: z.array(z.number().int().min(1).max(16)),
});

export type SavedMinisLayout = z.infer<typeof SavedMinisLayoutSchema>;

export const SavedNvimLayoutSchema = z.object({
  enabled: z.boolean(),
});

export const SavedWorkersLayoutSchema = z.object({
  enabled: z.boolean(),
  grid: z.literal("3x2").default("3x2"),
  slots: z.number().int().min(1).max(12).optional(),
});

export const SavedMinisLayoutSchemaWithEnabled = SavedMinisLayoutSchema.extend({
  enabled: z.boolean().optional(),
});

/** Persisted base-window layout — extendable; unknown keys preserved via passthrough. */
/** Extendable base layout patch (unknown keys preserved). */
export const SavedBaseLayoutSchema = z.object({}).passthrough();

export type SavedBaseLayout = z.infer<typeof SavedBaseLayoutSchema>;

export const SavedLayoutSchema = z
  .object({
    nvim: SavedNvimLayoutSchema.optional(),
    workers: SavedWorkersLayoutSchema.optional(),
    minis: SavedMinisLayoutSchemaWithEnabled.optional(),
    base: SavedBaseLayoutSchema.optional(),
  })
  .passthrough();

export type SavedLayout = z.infer<typeof SavedLayoutSchema>;

// -- Top-level mesh-agents.json -----------------------------------------

export const MeshAgentsSchema = z.object({
  /** Schema version for future migrations. */
  schemaVersion: z.literal(1).default(1),
  /** Tmux session name ("mesh"). */
  session: z.string().min(1),
  /** Workspace root. */
  workdir: z.string().min(1),
  manager: ManagerSlotSchema.optional(),
  manager2: ManagerSlotSchema.optional(),
  secretary: SecretarySlotSchema.optional(),
  workers: z.array(WorkerSlotSchema).default([]),
  minis: z.array(MiniSlotSchema).default([]),
  /** Saved layout overrides (e.g. minis grid/leads); profile yaml is fallback only. */
  layout: SavedLayoutSchema.optional(),
  conventions: ConventionsSchema,
  /** ISO-8601 timestamp of last mutation. */
  updatedAt: z.string().datetime().optional(),
});

export type MeshAgents = z.infer<typeof MeshAgentsSchema>;

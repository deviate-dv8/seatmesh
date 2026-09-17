import { z } from "zod";
import { expandColumnAlias } from "./seat-kind.js";

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
 * Slot mapping: primary manager + primary secretary + coords (every other
 * base column id from the profile) + workers + minis.
 */

/**
 * Seat harness kind id (`opencode`, `opencode-cpe`, custom extends…).
 * Open string — validated at switch/launch against resolved agent kinds, not a closed enum.
 * Legacy enum values remain valid; custom kinds (extends) are allowed.
 */
export const CliTypeSchema = z.string().min(1);

export type CliType = z.infer<typeof CliTypeSchema>;

/** Well-known builtin kind ids (documentation / completion seeds — not a schema gate). */
export const BUILTIN_CLI_TYPE_IDS = [
  "agent",
  "claude",
  "kiro",
  "opencode",
  "opencode-cpe",
  "empty",
] as const;

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

export const SavedLogsLayoutSchema = z.object({
  enabled: z.boolean(),
  window: z.string().optional(),
  index: z.number().int().min(0).max(20).optional(),
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
    logs: SavedLogsLayoutSchema.optional(),
    base: SavedBaseLayoutSchema.optional(),
  })
  .passthrough();

export type SavedLayout = z.infer<typeof SavedLayoutSchema>;

// -- Top-level mesh-agents.json -----------------------------------------

const MeshAgentsObjectSchema = z
  .object({
    /** Schema version for future migrations. */
    schemaVersion: z.literal(1).default(1),
    /** Tmux session name ("mesh"). */
    session: z.string().min(1),
    /** Workspace root. */
    workdir: z.string().min(1),
    manager: ManagerSlotSchema.optional(),
    /** Every extra base column id (not primary manager / secretary). */
    coords: z.record(z.string(), ManagerSlotSchema).optional(),
    secretary: SecretarySlotSchema.optional(),
    workers: z.array(WorkerSlotSchema).default([]),
    minis: z.array(MiniSlotSchema).default([]),
    /** Saved layout overrides (e.g. minis grid/leads); profile yaml is fallback only. */
    layout: SavedLayoutSchema.optional(),
    conventions: ConventionsSchema,
    /** ISO-8601 timestamp of last mutation. */
    updatedAt: z.string().datetime().optional(),
  })
  .passthrough();

const COMPACT_COORD_KEY = /^[a-z]+\d+$/;

export const MeshAgentsSchema = MeshAgentsObjectSchema.transform((data) => {
  const coords = { ...(data.coords ?? {}) };
  const rest: typeof data = { ...data };
  for (const [key, val] of Object.entries(data)) {
    if (!COMPACT_COORD_KEY.test(key)) continue;
    const parsed = ManagerSlotSchema.safeParse(val);
    if (!parsed.success) continue;
    const id = expandColumnAlias(key).find((a) => a.includes("-")) ?? key;
    if (!coords[id]) {
      coords[id] = { ...parsed.data, name: parsed.data.name ?? id };
    }
    delete (rest as Record<string, unknown>)[key];
  }
  return {
    ...rest,
    coords: Object.keys(coords).length ? coords : undefined,
  };
});

export type MeshAgents = z.infer<typeof MeshAgentsSchema>;

export function extraColumnSlot(
  mesh: MeshAgents,
  id: string,
): z.infer<typeof ManagerSlotSchema> | undefined {
  if (id === "manager") return mesh.manager;
  return mesh.coords?.[id];
}

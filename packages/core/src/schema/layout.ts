import { z } from "zod";
import { gridPaneCapacity } from "../layout/minis.js";
import { COLUMN_ID_RE, SEAT_KINDS } from "./seat-kind.js";

export { COLUMN_ID_RE, SEAT_KINDS } from "./seat-kind.js";
export type { SeatKind } from "./seat-kind.js";

/** Open column id from profile — not a closed manager-N enum. */
export const BaseColumnSchema = z
  .string()
  .regex(COLUMN_ID_RE, "column id must match [a-z][a-z0-9-]{0,31}");
export type BaseColumn = z.infer<typeof BaseColumnSchema>;

const SeatKindSchema = z.enum(SEAT_KINDS);

const MinisLeadsSchema = z
  .union([
    z.array(z.number().int().min(1).max(16)),
    z.object({
      top: z.number().int().min(1).max(16).default(1),
      bottom: z.number().int().min(1).max(16).default(2),
    }),
  ])
  .transform((v) => (Array.isArray(v) ? v : [v.top, v.bottom]));

export const LayoutSchema = z.object({
  nvim: z
    .object({
      window: z.string().default("nvim"),
      /** Optional editor window (index 0 when enabled). Off on minimal cold start. */
      enabled: z.boolean().default(false),
    })
    .default({ window: "nvim", enabled: false }),
  base: z
    .object({
      window: z.string().default("base"),
      /**
       * Horizontal base columns — any ids. Kind is prefix or `kinds` map
       * (manager / secretary / …). N managers and N secretaries are config, not enum.
       */
      columns: z.array(BaseColumnSchema).min(1).max(128).default(["manager", "secretary"]),
      /** Override inferred kind per column id (`relief: manager`, `sec-west: secretary`). */
      kinds: z.record(z.string(), SeatKindSchema).optional(),
      /** CLI type per column id (default: secretary-kind=opencode, else agent). */
      cli: z.record(z.string(), z.string()).optional(),
      /** Human-typed panes: daemon must queue while typing (FQ-inject-co-typed-pane). */
      humanCoTyped: z.array(BaseColumnSchema).optional(),
      /** Secretary column width (percent of base window width). Default 50. */
      secretaryWidthPct: z.number().int().min(25).max(65).optional(),
      /**
       * When to auto-repair coord panes (secretary) from mesh-agents.json.
       * reload=false: never kill/relaunch live CLIs on `./sm.sh reload` (default).
       */
      coordSync: z
        .object({
          reload: z.boolean().default(false),
          attach: z.boolean().default(true),
        })
        .default({ reload: false, attach: true }),
    })
    .default({ window: "base", columns: ["manager", "secretary"] }),
  workers: z
    .object({
      window: z.string().default("workers"),
      /** Equal grid: `3x2`, `4x2`, etc. `slots` must equal cols*rows. */
      grid: z
        .string()
        .regex(/^\d+x\d+$/, "grid must be COLSxROWS e.g. 3x2")
        .default("3x2"),
      slots: z.number().int().min(1).max(12).default(6),
      /** Off on cold start — manager runs `./sm.sh layout` to add worker grid. */
      enabled: z.boolean().default(false),
    })
    .default({ window: "workers", grid: "3x2", slots: 6, enabled: false })
    .superRefine((w, ctx) => {
      const cap = gridPaneCapacity(w.grid);
      if (w.slots !== cap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `workers.slots (${w.slots}) must equal grid capacity (${cap} for ${w.grid})`,
        });
      }
    }),
  minis: z
    .object({
      window: z.string().default("minis"),
      /** Off on cold start — manager runs `./sm.sh layout` to add mini grid. */
      enabled: z.boolean().default(false),
      /** Equal grid: `2x2`, `4x2`, etc. `max` must equal cols*rows. */
      grid: z
        .string()
        .regex(/^\d+x\d+$/, "grid must be COLSxROWS e.g. 2x2")
        .default("4x2"),
      max: z.number().int().min(1).max(16).default(8),
      /** Lead mini ids per row (column 0). `[1]` = mini-1 top-left only; `[1,2]` = 4x2 harness layout. */
      leads: MinisLeadsSchema.default([1, 2]),
    })
    .default({
      window: "minis",
      grid: "4x2",
      max: 8,
      leads: [1, 2],
      enabled: false,
    })
    .superRefine((m, ctx) => {
      const cap = gridPaneCapacity(m.grid);
      if (m.max !== cap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `minis.max (${m.max}) must equal grid capacity (${cap} for ${m.grid})`,
        });
      }
      for (const id of m.leads) {
        if (id < 1 || id > m.max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `minis.leads contains ${id} outside 1..${m.max}`,
          });
        }
      }
    }),
  /** Daemon / inbox tails — default window index 9 (`prefix 9`). */
  logs: z
    .object({
      window: z.string().default("logs"),
      /** Prefer tmux window index 9 so it stays on the right of 0:nvim / 1:base. */
      index: z.number().int().min(0).max(20).default(9),
      enabled: z.boolean().default(true),
    })
    .default({ window: "logs", index: 9, enabled: true }),
});

export type MeshLayout = z.infer<typeof LayoutSchema>;

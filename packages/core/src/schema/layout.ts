import { z } from "zod";
import { gridPaneCapacity } from "../layout/minis.js";

export const BaseColumnSchema = z.enum(["manager", "manager-2", "secretary"]);
export type BaseColumn = z.infer<typeof BaseColumnSchema>;

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
      /** Horizontal columns: manager (+ optional manager-2) + secretary (right). */
      columns: z.array(BaseColumnSchema).min(2).max(3).default(["manager", "secretary"]),
      /** Optional CLI type per column (defaults: manager/manager-2=agent, secretary=opencode). */
      cli: z
        .object({
          manager: z.string().optional(),
          "manager-2": z.string().optional(),
          secretary: z.string().optional(),
        })
        .optional(),
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
      grid: z.literal("3x2"),
      slots: z.number().int().min(1).max(12).default(6),
      /** Off on cold start — manager runs `./sm.sh layout` to add worker grid. */
      enabled: z.boolean().default(false),
    })
    .default({ window: "workers", grid: "3x2", slots: 6, enabled: false }),
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
});

export type MeshLayout = z.infer<typeof LayoutSchema>;

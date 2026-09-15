import { z } from "zod";

export const SlotPromptRecordSchema = z.object({
  id: z.string().uuid(),
  ts: z.string().datetime(),
  /** worker-1, mini-3, manager, secretary — file path key */
  slot: z.string().min(1),
  paneId: z.string().optional(),
  providerId: z.string().min(1),
  /**
   * Who answered: seat + provider tag (`slot-3-kiro`, `mini-1-oc`, `manager-claude`).
   * Survives agent switches on the same seat — each record names the CLI that spoke.
   */
  agent: z.string().min(1).optional(),
  /** Inbound side: operator typing vs mesh/inbox inject. */
  humanKind: z.enum(["human", "system"]).optional(),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  humanPrompt: z.string().min(1),
  agentResponse: z.string().optional(),
  /** sha256 prefix for dedupe on record/scrape */
  turnHash: z.string().optional(),
});

export type SlotPromptRecord = z.infer<typeof SlotPromptRecordSchema>;

export interface PromptQuery {
  slot?: string;
  providerId?: string;
  /** Filter by speaker id (`mini-1-oc`, `slot-3-kiro`, …). */
  agent?: string;
  sessionId?: string;
  model?: string;
  since?: string;
  limit?: number;
}

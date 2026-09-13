/**
 * BullMQ worker definitions — one worker type per queue channel.
 * Handlers call orchestrator drain + limit hooks; never tmux directly from producers.
 */

export const QUEUE_NAMES = {
  inject: "mesh-inject",
  limits: "mesh-limits",
  connectivity: "mesh-connectivity",
  checkback: "mesh-checkback",
} as const;

// Phase 3: new Worker(QUEUE_NAMES.inject, processor, { connection })

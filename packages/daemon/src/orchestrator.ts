/**
 * Inbox orchestrator — sole pane writer path (see mesh-orchestrator.ts).
 */
import type { QueueDrainPolicy, InjectJob, ProviderRegistry } from "@seat-mesh/core";
import {
  orchestratorDrainTick,
  type MeshOrchestratorCtx,
  type DrainTickResult,
} from "./mesh-orchestrator.js";

export interface OrchestratorDeps {
  registry: ProviderRegistry;
  policy: QueueDrainPolicy;
  ctx: MeshOrchestratorCtx;
  enqueue: (job: InjectJob) => Promise<void>;
}

export class InboxOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async drainTick(): Promise<DrainTickResult> {
    return orchestratorDrainTick(this.deps.ctx);
  }
}

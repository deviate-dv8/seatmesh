import type { AgentProvider, LoadedProfile, PaneSnapshot, ProviderRegistry } from "@seat-mesh/core";
import {
  chatFileConfigForLoaded,
  recordComposerDraftFromPane,
  recordInjectSentFromPane,
} from "@seat-mesh/core";

function fireAndForget(p: Promise<unknown>): void {
  void p.catch(() => {});
}

/** Persist unsent composer / follow-up / pending text (non-blocking). */
export function persistComposerDraft(
  loaded: LoadedProfile | undefined,
  prov: AgentProvider,
  snap: PaneSnapshot,
): void {
  if (!loaded || !prov.humanDraft) return;
  const detection = prov.detect(snap);
  fireAndForget(
    (async () => {
      const cfg = chatFileConfigForLoaded(loaded);
      await recordComposerDraftFromPane(loaded.workspace, cfg, prov, snap, detection);
    })(),
  );
}

/** Log daemon inject as sent and drop stale draft row (non-blocking). */
export function persistInjectSent(
  loaded: LoadedProfile | undefined,
  prov: AgentProvider,
  snap: PaneSnapshot,
  message: string,
): void {
  if (!loaded) return;
  const detection = prov.detect(snap);
  fireAndForget(
    (async () => {
      const cfg = chatFileConfigForLoaded(loaded);
      await recordInjectSentFromPane(loaded.workspace, cfg, prov, snap, message, detection);
    })(),
  );
}

/** Early deliverToPane hook — save draft even when delivery is held. */
export function persistComposerDraftFromDeliver(
  loaded: LoadedProfile | undefined,
  registry: ProviderRegistry,
  snap: PaneSnapshot,
): void {
  if (!loaded) return;
  const prov = registry.detect(snap);
  if (!prov?.humanDraft) return;
  persistComposerDraft(loaded, prov, snap);
}

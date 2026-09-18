/**
 * Pure diff between "meshes currently watched" and "meshes registered right now"
 * (`~/.config/seatmesh/sessions.json`). Kept separate from the host supervisor's
 * spawn/health loop so the add/remove decision is unit-testable without child
 * processes or timers.
 */
export interface RegistryDiff {
  /** profilePaths to start a watcher for (newly registered, or not yet watched). */
  toStart: string[];
  /** profilePaths to stop watching (no longer registered). */
  toStop: string[];
}

export function diffRegistrySessions(
  activeProfilePaths: Iterable<string>,
  registeredProfilePaths: Iterable<string>,
): RegistryDiff {
  const active = new Set(activeProfilePaths);
  const registered = new Set(registeredProfilePaths);
  const toStart = [...registered].filter((p) => !active.has(p));
  const toStop = [...active].filter((p) => !registered.has(p));
  return { toStart, toStop };
}

import type { MeshProfile } from "../schema/profile.js";

/** Resolved periodic mesh-agents.json scrape interval (0 = off). */
export function resolveAutoScrapeIntervalMs(profile: MeshProfile): number {
  if (profile.daemon.autoScrape === false) return 0;
  const explicit = profile.daemon.autoScrapeIntervalMs;
  if (explicit != null) return explicit;
  return profile.state.autoScrapeIntervalMs ?? 60_000;
}

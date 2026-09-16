import type { HubSession } from '#services/session_registry'
import { getHubSession } from '#services/session_registry'

/** One-session resolve for session-scoped pages (avoids probing every mesh). */
export async function resolveHubSession(
  id: string,
  opts: { probe?: boolean } = {}
): Promise<{ session: HubSession } | { session: null }> {
  const session = await getHubSession(id, { probe: opts.probe !== false })
  if (!session) return { session: null }
  return { session }
}

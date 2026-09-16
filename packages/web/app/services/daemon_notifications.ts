export type NotificationRow = {
  id: string
  sessionId: string
  sessionName: string
  kind: string
  title: string
  body?: string
  check?: string
  fromSeat?: string
  targetSeat?: string
  url?: string
  infoUrl?: string
  cardId?: string
  status: string
  createdAt: string
  expiresAt?: string
  actedAt?: string
  actedLabel?: string
}

export type NotificationSummary = {
  sent: number
  acted: number
  expired: number
  updatedAt: string | null
}

async function daemonFetch(port: number, path: string) {
  const budgetMs = 5000
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), budgetMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: ac.signal })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      throw new Error(text.slice(0, 200) || res.statusText)
    }
    if (!res.ok) {
      const err = (json as { error?: string } | null)?.error || res.statusText
      throw new Error(err)
    }
    return json
  } finally {
    clearTimeout(t)
  }
}

export async function listNotifications(
  port: number,
  opts: { all?: boolean; kind?: string; limit?: number } = {},
): Promise<{ notifications: NotificationRow[]; summary: NotificationSummary }> {
  const q = new URLSearchParams()
  if (opts.all) q.set('all', '1')
  if (opts.kind) q.set('kind', opts.kind)
  if (opts.limit != null) q.set('limit', String(opts.limit))
  const qs = q.toString()
  const body = (await daemonFetch(port, `/notifications${qs ? `?${qs}` : ''}`)) as {
    notifications?: NotificationRow[]
    summary?: NotificationSummary
  }
  return {
    notifications: body.notifications ?? [],
    summary: body.summary ?? { sent: 0, acted: 0, expired: 0, updatedAt: null },
  }
}

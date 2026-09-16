/** Daemon queue APIs: /ack /patience /inbox /pane-ops */

async function daemonFetch(port: number, path: string, init?: RequestInit) {
  const budgetMs = 5000
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), budgetMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    })
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

export type AckRow = {
  id?: string
  askId?: string
  from?: string
  to?: string
  summary?: string
  openedAt?: string
  [key: string]: unknown
}

export type PatienceRow = {
  id: string
  kind?: string
  expect?: string
  exp?: string
  renew?: string | number
  pane?: string
  [key: string]: unknown
}

export type InboxRow = {
  id?: string
  unresolved?: boolean
  from?: string
  body?: string
  [key: string]: unknown
}

export type PaneOpRow = {
  id?: string
  kind?: string
  target?: string
  [key: string]: unknown
}

export type QueueSnapshot = {
  acks: AckRow[]
  checkbacks: PatienceRow[]
  inbox: InboxRow[]
  paneOps: PaneOpRow[]
}

function asArray<T>(v: unknown, keys: string[]): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v && typeof v === 'object') {
    for (const k of keys) {
      const x = (v as Record<string, unknown>)[k]
      if (Array.isArray(x)) return x as T[]
    }
  }
  return []
}

export async function fetchQueues(port: number): Promise<QueueSnapshot> {
  const [ackRaw, patRaw, inboxRaw, paneRaw] = await Promise.all([
    daemonFetch(port, '/ack').catch(() => null),
    daemonFetch(port, '/patience').catch(() => null),
    daemonFetch(port, '/inbox').catch(() => null),
    daemonFetch(port, '/pane-ops').catch(() => null),
  ])
  return {
    acks: asArray<AckRow>(ackRaw, ['entries', 'acks', 'items']),
    checkbacks: asArray<PatienceRow>(patRaw, ['entries', 'checkbacks', 'patience', 'items', 'active']),
    inbox: asArray<InboxRow>(inboxRaw, ['entries', 'inbox', 'unresolved', 'items', 'messages']),
    paneOps: asArray<PaneOpRow>(paneRaw, ['rows', 'entries', 'paneOps', 'ops', 'pending', 'items']),
  }
}

export async function cancelCheckback(port: number, id: string): Promise<void> {
  await daemonFetch(port, `/patience/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: '{}',
  })
}

export async function resolveInbox(port: number, id: string): Promise<void> {
  await daemonFetch(port, '/inbox/resolve', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export async function clearAck(port: number, id?: string): Promise<void> {
  await daemonFetch(port, '/ack/clear', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : {}),
  })
}

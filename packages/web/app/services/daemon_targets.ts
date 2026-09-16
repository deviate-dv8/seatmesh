import type { DaemonHealth } from '#services/session_registry'

export type TargetRow = {
  id: string
  status: string
  goal: string
  deadlineAt: string
  kind?: string
  parentId?: string
  triageTo?: string[]
  createdAt?: string
  updatedAt?: string
}

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

export async function listTargets(port: number, all = false): Promise<TargetRow[]> {
  const q = all ? '?all=1' : ''
  const body = (await daemonFetch(port, `/targets${q}`)) as { targets?: TargetRow[] }
  return body.targets ?? []
}

export async function createTarget(
  port: number,
  input: {
    goal: string
    deadlineAt: string
    kind?: 'scope' | 'slice'
    parentId?: string
  }
): Promise<TargetRow> {
  const body = (await daemonFetch(port, '/targets', {
    method: 'POST',
    body: JSON.stringify(input),
  })) as { target: TargetRow }
  return body.target
}

export async function targetAction(
  port: number,
  id: string,
  action: 'done' | 'cancel' | 'triage' | 'remind'
): Promise<void> {
  await daemonFetch(port, `/targets/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: '{}',
  })
}

export type { DaemonHealth }

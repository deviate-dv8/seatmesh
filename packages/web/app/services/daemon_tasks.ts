export type TaskRow = {
  id: string
  sessionId: string
  sessionName: string
  seat: string
  text: string
  status: string
  source?: string
  assignedBy?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

export type TaskSummary = {
  open: number
  inProgress: number
  done: number
  cancelled: number
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

export async function listTasks(
  port: number,
  opts: { all?: boolean; seat?: string } = {}
): Promise<{ tasks: TaskRow[]; summary: TaskSummary }> {
  const q = new URLSearchParams()
  if (opts.all) q.set('all', '1')
  if (opts.seat) q.set('seat', opts.seat)
  const qs = q.toString()
  const body = (await daemonFetch(port, `/tasks${qs ? `?${qs}` : ''}`)) as {
    tasks?: TaskRow[]
    summary?: TaskSummary
  }
  return {
    tasks: body.tasks ?? [],
    summary: body.summary ?? { open: 0, inProgress: 0, done: 0, cancelled: 0, updatedAt: null },
  }
}

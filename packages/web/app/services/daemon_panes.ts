/** Daemon pane / terminal APIs: /panes, /panes/%N/capture, /to-peer */

async function daemonFetch(port: number, path: string, init?: RequestInit) {
  const budgetMs = path.includes('/capture') ? 4000 : 1500
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

export type PaneRow = {
  paneId: string
  label: string
  role: string
  slot: string
  mini: string
  ports: string
  window: string
  command: string
}

export type PaneCapture = {
  paneId: string
  windowName?: string
  cwd?: string
  currentCommand?: string
  captureTail?: string
  captureTailAnsi?: string
  options?: Record<string, string>
}

export async function fetchPanes(port: number): Promise<{
  session: string
  wsTmux: string
  panes: PaneRow[]
}> {
  const data = (await daemonFetch(port, '/panes')) as {
    session?: string
    wsTmux?: string
    panes?: PaneRow[]
  }
  return {
    session: data.session ?? '',
    wsTmux: data.wsTmux ?? `ws://127.0.0.1:${port}/ws/tmux`,
    panes: data.panes ?? [],
  }
}

export async function fetchPaneCapture(port: number, paneId: string): Promise<PaneCapture | null> {
  try {
    const q = new URLSearchParams({ pane: paneId })
    const data = (await daemonFetch(port, `/panes/capture?${q}`)) as {
      pane?: PaneCapture
    }
    return data.pane ?? null
  } catch {
    return null
  }
}

export async function sendPeerToPane(
  port: number,
  input: { msg: string; targetPane: string; targetLabel?: string; kind?: string }
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const data = (await daemonFetch(port, '/to-peer', {
      method: 'POST',
      body: JSON.stringify({
        msg: input.msg,
        targetPane: input.targetPane,
        targetLabel: input.targetLabel ?? null,
        kind: input.kind ?? 'prompt',
        fromSlot: 'operator',
        fromAgent: 'hub',
      }),
    })) as { ok?: boolean; id?: string; error?: string }
    return { ok: data.ok === true, id: data.id, error: data.error }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

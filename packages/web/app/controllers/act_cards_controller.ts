import type { HttpContext } from '@adonisjs/core/http'
import { listHubSessions } from '#services/session_registry'

export type ActCardPayload = {
  id: string
  title: string
  body: string
  links: Array<{ label: string; token: string; url: string }>
  expiresAt: number
}

export type ActV1Json = {
  ok: boolean
  label?: string
  summary?: string
  error?: string
}

function rewriteLinksForHub(
  card: ActCardPayload,
  daemonPort: number,
  hubOrigin = 'http://127.0.0.1:3190'
): ActCardPayload {
  return {
    ...card,
    links: card.links.map((l) => {
      if (!l.token) return l
      // Action tokens always go through hub proxy (JSON from card UI).
      return {
        ...l,
        url: `${hubOrigin}/act/v1/${l.token}?port=${daemonPort}`,
      }
    }),
  }
}

async function fetchCardFromPort(
  port: number,
  cardId: string
): Promise<{ card: ActCardPayload; port: number; sessionId?: string } | null> {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 2500)
    const res = await fetch(`http://127.0.0.1:${port}/act/card/${cardId}?format=json`, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    })
    clearTimeout(t)
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      card?: ActCardPayload
      sessionId?: string
    }
    if (!data.ok || !data.card) return null
    return { card: data.card, port, sessionId: data.sessionId }
  } catch {
    return null
  }
}

async function fetchActFromPort(port: number, token: string): Promise<{ status: number; body: ActV1Json }> {
  const res = await fetch(`http://127.0.0.1:${port}/act/v1/${encodeURIComponent(token)}?format=json`, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  })
  let body: ActV1Json
  try {
    body = (await res.json()) as ActV1Json
  } catch {
    body = {
      ok: false,
      error: 'bad_daemon_response',
      summary: `Daemon returned non-JSON (${res.status})`,
    }
  }
  return { status: res.status, body }
}

export default class ActCardsController {
  /** Canonical card UI — data from daemon JSON; actions via hub /act/v1 proxy. */
  async show({ inertia, params, request }: HttpContext) {
    const cardId = String(params.id)
    const portQ = request.input('port')
    const portHint = portQ != null ? Number(portQ) : NaN
    const hubOrigin = `http://127.0.0.1:${Number(process.env.PORT || 3190)}`

    if (Number.isFinite(portHint) && portHint > 0) {
      const hit = await fetchCardFromPort(portHint, cardId)
      if (hit) {
        return inertia.render('act/card', {
          card: rewriteLinksForHub(hit.card, hit.port, hubOrigin),
          daemonPort: hit.port,
          sessionId: hit.sessionId ?? null,
          daemonCardUrl: `http://127.0.0.1:${hit.port}/act/card/${cardId}?local=1`,
        })
      }
      return inertia.render('act/card', {
        card: null,
        daemonPort: portHint,
        sessionId: null,
        daemonCardUrl: null,
        error: 'Card expired or not found on that daemon.',
      })
    }

    const sessions = await listHubSessions({ probe: true })
    const up = sessions.filter((s) => s.daemonUp && s.daemonPort > 0)
    const results = await Promise.all(up.map((s) => fetchCardFromPort(s.daemonPort, cardId)))
    const hit = results.find(Boolean)
    if (!hit) {
      return inertia.render('act/card', {
        card: null,
        daemonPort: null,
        sessionId: null,
        daemonCardUrl: null,
        error: 'Card expired or not found on any live daemon.',
      })
    }
    return inertia.render('act/card', {
      card: rewriteLinksForHub(hit.card, hit.port, hubOrigin),
      daemonPort: hit.port,
      sessionId: hit.sessionId ?? null,
      daemonCardUrl: `http://127.0.0.1:${hit.port}/act/card/${cardId}?local=1`,
    })
  }

  /** Proxy one-shot Run/Yes/No to the owning daemon as JSON (no old HTML shell). */
  async act({ params, request, response }: HttpContext) {
    const token = String(params.token)
    const portQ = request.input('port')
    const portHint = portQ != null ? Number(portQ) : NaN

    if (Number.isFinite(portHint) && portHint > 0) {
      try {
        const r = await fetchActFromPort(portHint, token)
        return response.status(r.status).json(r.body)
      } catch (e) {
        return response.status(502).json({
          ok: false,
          error: 'proxy_failed',
          summary: `act proxy failed: ${(e as Error).message}`,
        })
      }
    }

    const sessions = await listHubSessions({ probe: true })
    const up = sessions.filter((s) => s.daemonUp && s.daemonPort > 0)
    for (const s of up) {
      try {
        const r = await fetchActFromPort(s.daemonPort, token)
        // 404 = wrong daemon / expired; keep scanning
        if (r.status === 404) continue
        return response.status(r.status).json(r.body)
      } catch {
        /* try next */
      }
    }
    return response.status(404).json({
      ok: false,
      error: 'expired_or_used',
      summary: 'Action expired, already used, or no live daemon had this token.',
    })
  }
}

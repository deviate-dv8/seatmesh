import type { HttpContext } from '@adonisjs/core/http'
import {
  listHostedMds,
  loadProfile,
  readHostedMd,
  hostedMdHubUrl,
  defaultHubOrigin,
} from '@seat-mesh/core'
import { listHubSessions } from '#services/session_registry'

function loadSessionProfile(sessionId: string, sessions: Awaited<ReturnType<typeof listHubSessions>>) {
  const hit =
    sessions.find((s) => s.id === sessionId || s.sessionName === sessionId) ??
    sessions.find((s) => s.label === sessionId)
  if (!hit?.profilePath) return null
  try {
    return loadProfile(hit.profilePath)
  } catch {
    return null
  }
}

export default class MdsController {
  async index({ inertia, request, response }: HttpContext) {
    const sessions = await listHubSessions({ probe: false })
    const items: Array<{
      title: string
      url: string
      when: string
      mesh: string
      slug: string
      sessionId: string
    }> = []

    for (const s of sessions) {
      if (!s.profilePath) continue
      let loaded
      try {
        loaded = loadProfile(s.profilePath)
      } catch {
        continue
      }
      for (const md of listHostedMds(loaded, { sessionId: s.id })) {
        items.push({
          title: md.title,
          url: hostedMdHubUrl(loaded, md.slug, s.id),
          when: md.when,
          mesh: md.mesh,
          slug: md.slug,
          sessionId: s.id,
        })
      }
    }

    items.sort((a, b) => (a.when < b.when ? 1 : -1))

    const note = `Job-grouped docs — start at INDEX. Mirror: .sm/mds/docs/. ${defaultHubOrigin()}/mds`
    // TODO 10.1 — same JSON content-negotiation as mesh_sessions_controller.ts.
    if (request.accepts(['html', 'json']) === 'json') {
      return response.json({ note, items })
    }
    return inertia.render('mds/index', { note, items })
  }

  async show({ inertia, params, response, request }: HttpContext) {
    const sessionId = String(params.sessionId ?? '')
    // Adonis catch-all: params['*'] or leftover path after /mds/:sessionId/
    const star = params['*']
    const starPath = Array.isArray(star) ? star.join('/') : typeof star === 'string' ? star : ''
    const fromUrl = request.url().replace(/^\/mds\/[^/]+\//, '').replace(/\/$/, '')
    const slug = decodeURIComponent(String(starPath || fromUrl || params.slug || ''))
      .replace(/\.md$/i, '')
      .replace(/^\/+/, '')
    if (!sessionId || !slug) {
      return response.redirect('/mds')
    }

    const sessions = await listHubSessions({ probe: false })
    const loaded = loadSessionProfile(sessionId, sessions)
    if (!loaded) {
      return response.notFound({ error: `session not found: ${sessionId}` })
    }

    const doc = readHostedMd(loaded, slug)
    if (!doc) {
      if (request.accepts(['html', 'json']) === 'json') {
        return response.status(404).json({ error: `md not found: ${slug}` })
      }
      return response.notFound({ error: `md not found: ${slug}` })
    }

    const payload = {
      title: doc.title,
      body: doc.body,
      slug,
      mesh: loaded.profile.name,
      sessionId,
      file: doc.absPath,
    }
    if (request.accepts(['html', 'json']) === 'json') {
      return response.json(payload)
    }
    return inertia.render('mds/show', payload)
  }
}

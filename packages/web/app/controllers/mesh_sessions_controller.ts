import type { HttpContext } from '@adonisjs/core/http'
import { listHubSessions } from '#services/session_registry'
import { resolveHubSession } from '#services/resolve_session'

export default class MeshSessionsController {
  async index({ inertia, request, response }: HttpContext) {
    const sessions = await listHubSessions({ probe: true })
    const rows = sessions.map((s) => ({
      id: s.id,
      label: s.label,
      sessionName: s.sessionName,
      daemonPort: s.daemonPort,
      tmuxLive: s.tmuxLive,
      daemonUp: s.daemonUp,
      // TODO 7.5 (backend only) — surfaces which sessions the opt-in `seatmesh
      // host` supervisor manages. No UI treatment for this yet in sessions/index.vue.
      viaHostSupervisor: s.viaHostSupervisor,
      tasksOpen: s.tasks?.open ?? s.health?.tasksOpen ?? null,
      tasksDone: s.tasks?.done ?? s.health?.tasksDone ?? null,
      notifySent: s.health?.notifySent ?? null,
    }))
    // TODO 10.1 — JSON content-negotiation so a standalone consumer (e.g. the
    // TODO 10.2 sidebar) can hit the same route real operators already use,
    // instead of needing a separate API. Additive: existing Inertia clients
    // are unaffected, same request.accepts(['json']) pattern already used in
    // session_ops_controller.ts's restartInbox.
    if (request.accepts(['html', 'json']) === 'json') {
      return response.json({
        sessions: rows,
        note: 'From ~/.config/seatmesh/sessions.json + parallel /health (TTL cache ~2.5s).',
      })
    }
    return inertia.render('sessions/index', {
      sessions: rows,
      note: 'From ~/.config/seatmesh/sessions.json + parallel /health (TTL cache ~2.5s).',
    })
  }

  async show({ inertia, params, request, response }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id))
    if (!resolved.session) {
      if (request.accepts(['html', 'json']) === 'json') {
        return response.status(404).json({ error: `session not found: ${params.id}` })
      }
      return response.redirect().toRoute('sessions.index')
    }
    const session = resolved.session
    const payload = {
      id: session.id,
      label: session.label,
      sessionName: session.sessionName,
      workspace: session.workspace,
      profilePath: session.profilePath,
      daemonPort: session.daemonPort,
      tmuxLive: session.tmuxLive,
      daemonUp: session.daemonUp,
      health: session.health,
    }
    if (request.accepts(['html', 'json']) === 'json') {
      return response.json({ session: payload, note: 'Live health snapshot from daemon /health.' })
    }
    return inertia.render('sessions/show', {
      id: session.id,
      note: 'Live health snapshot from daemon /health.',
      session: payload,
    })
  }
}

import type { HttpContext } from '@adonisjs/core/http'
import { listHubSessions } from '#services/session_registry'
import { resolveHubSession } from '#services/resolve_session'

export default class MeshSessionsController {
  async index({ inertia }: HttpContext) {
    const sessions = await listHubSessions({ probe: true })
    return inertia.render('sessions/index', {
      sessions: sessions.map((s) => ({
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
      })),
      note: 'From ~/.config/seatmesh/sessions.json + parallel /health (TTL cache ~2.5s).',
    })
  }

  async show({ inertia, params, response }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id))
    if (!resolved.session) {
      return response.redirect().toRoute('sessions.index')
    }
    const session = resolved.session
    return inertia.render('sessions/show', {
      id: session.id,
      note: 'Live health snapshot from daemon /health.',
      session: {
        id: session.id,
        label: session.label,
        sessionName: session.sessionName,
        workspace: session.workspace,
        profilePath: session.profilePath,
        daemonPort: session.daemonPort,
        tmuxLive: session.tmuxLive,
        daemonUp: session.daemonUp,
        health: session.health,
      },
    })
  }
}

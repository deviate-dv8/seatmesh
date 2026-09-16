import type { HttpContext } from '@adonisjs/core/http'
import { resolveHubSession } from '#services/resolve_session'
import {
  listNotifications,
  type NotificationRow,
  type NotificationSummary,
} from '#services/daemon_notifications'

async function sessionOrRedirect(id: string) {
  const resolved = await resolveHubSession(id)
  if (!resolved.session || !resolved.session.daemonPort) {
    return { session: null as null }
  }
  if (!resolved.session.daemonUp) {
    return { session: resolved.session, daemonDown: true as const }
  }
  return { session: resolved.session }
}

export default class SessionNotificationsController {
  async index({ inertia, params, request, response }: HttpContext) {
    const id = String(params.id)
    const all = request.input('all') === '1' || request.input('all') === 'true'
    const resolved = await sessionOrRedirect(id)
    if (!resolved.session) return response.redirect().toRoute('sessions.index')

    let notifications: NotificationRow[] = []
    let summary: NotificationSummary = { sent: 0, acted: 0, expired: 0, updatedAt: null }
    let error: string | null = null
    if (resolved.daemonDown) {
      error = `daemon down on :${resolved.session.daemonPort}`
    } else {
      try {
        const body = await listNotifications(resolved.session.daemonPort, { all, limit: 200 })
        notifications = body.notifications
        summary = body.summary
      } catch (e) {
        error = (e as Error).message
      }
    }

    return inertia.render('sessions/notifications', {
      id: resolved.session.id,
      all,
      error,
      session: {
        id: resolved.session.id,
        label: resolved.session.label,
        daemonPort: resolved.session.daemonPort,
        daemonUp: resolved.session.daemonUp,
      },
      notifications,
      summary,
    })
  }
}

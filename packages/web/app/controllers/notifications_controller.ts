import type { HttpContext } from '@adonisjs/core/http'
import { listHubSessions, type HubSession } from '#services/session_registry'
import { listNotifications, type NotificationRow } from '#services/daemon_notifications'

type NotifRow = {
  severity: 'bad' | 'warn' | 'info'
  sessionId: string
  label: string
  text: string
  href: string
  when: string
  canRestart?: boolean
  kind?: 'health' | 'notify'
}

async function fetchSavedNotifyRows(sessions: HubSession[]): Promise<NotifRow[]> {
  const out: NotifRow[] = []
  await Promise.all(
    sessions.map(async (s) => {
      if (s.daemonUp !== true || !s.daemonPort) return
      try {
        const { notifications } = await listNotifications(s.daemonPort, { limit: 30 })
        for (const n of notifications) {
          out.push(notifyRowFromSaved(s, n))
        }
      } catch {
        /* skip session */
      }
    }),
  )
  return out.sort((a, b) => b.when.localeCompare(a.when))
}

function notifyRowFromSaved(s: HubSession, n: NotificationRow): NotifRow {
  const detail = n.check || n.body || n.fromSeat || n.kind
  return {
    severity: n.status === 'acted' ? 'info' : 'warn',
    sessionId: s.id,
    label: s.label,
    text: `${n.kind}: ${n.title}${detail ? ` — ${detail}` : ''}`,
    href: `/sessions/${s.id}/notifications`,
    when: n.createdAt,
    kind: 'notify',
  }
}

function alertsFromSessions(sessions: HubSession[]): NotifRow[] {
  const now = new Date().toISOString()
  const out: NotifRow[] = []
  for (const s of sessions) {
    if (s.daemonUp === false) {
      out.push({
        severity: 'bad',
        sessionId: s.id,
        label: s.label,
        text: `Daemon down on :${s.daemonPort}`,
        href: `/sessions/${s.id}/ops`,
        when: now,
        canRestart: true,
      })
    }
    if (s.health?.proxyDownActive) {
      out.push({
        severity: 'bad',
        sessionId: s.id,
        label: s.label,
        text: 'Proxy / carrier down',
        href: `/sessions/${s.id}`,
        when: now,
      })
    }
    if ((s.health?.peerUnsent ?? 0) > 0) {
      out.push({
        severity: 'warn',
        sessionId: s.id,
        label: s.label,
        text: `${s.health?.peerUnsent} peer unsent`,
        href: `/sessions/${s.id}/queues`,
        when: now,
      })
    }
    if ((s.health?.ackOpen ?? 0) > 0) {
      out.push({
        severity: 'info',
        sessionId: s.id,
        label: s.label,
        text: `${s.health?.ackOpen} open ACK(s)`,
        href: `/sessions/${s.id}/queues`,
        when: now,
      })
    }
    if ((s.health?.checkbackActive ?? 0) > 0) {
      out.push({
        severity: 'info',
        sessionId: s.id,
        label: s.label,
        text: `${s.health?.checkbackActive} checkback(s) armed`,
        href: `/sessions/${s.id}/queues`,
        when: now,
      })
    }
    if ((s.health?.inboxUnresolved ?? 0) > 0) {
      out.push({
        severity: 'warn',
        sessionId: s.id,
        label: s.label,
        text: `${s.health?.inboxUnresolved} unresolved inbox`,
        href: `/sessions/${s.id}/queues`,
        when: now,
      })
    }
  }
  return out
}

export default class NotificationsController {
  async index({ inertia, request, response }: HttpContext) {
    const sessions = await listHubSessions({ probe: true })
    const healthItems = alertsFromSessions(sessions)
    const savedItems = await fetchSavedNotifyRows(sessions)
    const items = [...savedItems, ...healthItems].sort((a, b) => b.when.localeCompare(a.when))
    const note =
      'Saved agent notify history (per session) + live health alerts. Session detail: /sessions/:id/notifications'
    // TODO 10.1 — same JSON content-negotiation as mesh_sessions_controller.ts.
    if (request.accepts(['html', 'json']) === 'json') {
      return response.json({ note, items })
    }
    return inertia.render('notifications/index', { note, items, pollMs: 10000 })
  }
}

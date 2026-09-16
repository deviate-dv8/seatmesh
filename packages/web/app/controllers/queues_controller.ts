import type { HttpContext } from '@adonisjs/core/http'
import { resolveHubSession } from '#services/resolve_session'
import {
  cancelCheckback,
  clearAck,
  fetchQueues,
  resolveInbox,
  type QueueSnapshot,
} from '#services/daemon_queues'

const emptyQueues = (): QueueSnapshot => ({
  acks: [],
  checkbacks: [],
  inbox: [],
  paneOps: [],
})

async function resolveSession(id: string) {
  return resolveHubSession(id)
}

export default class QueuesController {
  async index({ inertia, params, response, session }: HttpContext) {
    const resolved = await resolveSession(String(params.id))
    if (!resolved.session) {
      return response.redirect().toRoute('sessions.index')
    }
    let error: string | null = null
    let queues = emptyQueues()
    if (!resolved.session.daemonUp) {
      error = `daemon down on :${resolved.session.daemonPort}`
    } else {
      try {
        queues = await fetchQueues(resolved.session.daemonPort)
      } catch (e) {
        error = (e as Error).message
      }
    }
    const flashError = session.flashMessages.get('error') as string | undefined
    return inertia.render('sessions/queues', {
      id: resolved.session.id,
      error: flashError || error,
      session: {
        id: resolved.session.id,
        label: resolved.session.label,
        daemonPort: resolved.session.daemonPort,
        daemonUp: resolved.session.daemonUp,
        health: resolved.session.health,
      },
      queues,
      pollMs: 10000,
    })
  }

  async cancelCb({ params, response, session }: HttpContext) {
    const resolved = await resolveSession(String(params.id))
    if (!resolved.session?.daemonUp) {
      session.flash('error', 'daemon down')
      return response.redirect().toRoute('sessions.queues', { id: String(params.id) })
    }
    try {
      await cancelCheckback(resolved.session.daemonPort, String(params.cbId))
    } catch (e) {
      session.flash('error', (e as Error).message)
    }
    return response.redirect().toRoute('sessions.queues', { id: resolved.session.id })
  }

  async resolveInboxItem({ params, response, session }: HttpContext) {
    const resolved = await resolveSession(String(params.id))
    if (!resolved.session?.daemonUp) {
      session.flash('error', 'daemon down')
      return response.redirect().toRoute('sessions.queues', { id: String(params.id) })
    }
    try {
      await resolveInbox(resolved.session.daemonPort, String(params.itemId))
    } catch (e) {
      session.flash('error', (e as Error).message)
    }
    return response.redirect().toRoute('sessions.queues', { id: resolved.session.id })
  }

  async clearAck({ params, response, session }: HttpContext) {
    const resolved = await resolveSession(String(params.id))
    if (!resolved.session?.daemonUp) {
      session.flash('error', 'daemon down')
      return response.redirect().toRoute('sessions.queues', { id: String(params.id) })
    }
    try {
      await clearAck(resolved.session.daemonPort)
    } catch (e) {
      session.flash('error', (e as Error).message)
    }
    return response.redirect().toRoute('sessions.queues', { id: resolved.session.id })
  }
}

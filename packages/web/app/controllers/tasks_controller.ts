import type { HttpContext } from '@adonisjs/core/http'
import { resolveHubSession } from '#services/resolve_session'
import { listTasks, type TaskRow, type TaskSummary } from '#services/daemon_tasks'

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

export default class TasksController {
  async index({ inertia, params, request, response }: HttpContext) {
    const id = String(params.id)
    const all = request.input('all') === '1' || request.input('all') === 'true'
    const seat = String(request.input('seat') || '').trim() || undefined
    const resolved = await sessionOrRedirect(id)
    if (!resolved.session) return response.redirect().toRoute('sessions.index')

    let tasks: TaskRow[] = []
    let summary: TaskSummary = { open: 0, inProgress: 0, done: 0, cancelled: 0, updatedAt: null }
    let error: string | null = null
    if (resolved.daemonDown) {
      error = `daemon down on :${resolved.session.daemonPort}`
    } else {
      try {
        const body = await listTasks(resolved.session.daemonPort, { all, seat })
        tasks = body.tasks
        summary = body.summary
      } catch (e) {
        error = (e as Error).message
      }
    }

    return inertia.render('sessions/tasks', {
      id: resolved.session.id,
      all,
      seat: seat ?? '',
      error,
      session: {
        id: resolved.session.id,
        label: resolved.session.label,
        daemonPort: resolved.session.daemonPort,
        daemonUp: resolved.session.daemonUp,
      },
      tasks,
      summary,
    })
  }
}

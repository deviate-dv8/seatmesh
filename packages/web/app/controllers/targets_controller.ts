import type { HttpContext } from '@adonisjs/core/http'
import { resolveHubSession } from '#services/resolve_session'
import {
  createTarget,
  listTargets,
  targetAction,
  type TargetRow,
} from '#services/daemon_targets'

function parseDeadline(raw: string): string {
  const t = (raw || 'eod').trim()
  if (!t || /^eod$/i.test(t)) {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    return end.toISOString()
  }
  if (/^\d+[smhdw]$/i.test(t)) {
    const n = Number(t.slice(0, -1))
    const u = t.slice(-1).toLowerCase()
    const mult: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }
    return new Date(Date.now() + n * (mult[u] ?? 36e5)).toISOString()
  }
  const ms = Date.parse(t)
  if (Number.isNaN(ms)) throw new Error('bad deadline (eod | 6h | ISO)')
  return new Date(ms).toISOString()
}

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

export default class TargetsController {
  async index({ inertia, params, request, response }: HttpContext) {
    const id = String(params.id)
    const all = request.input('all') === '1' || request.input('all') === 'true'
    const resolved = await sessionOrRedirect(id)
    if (!resolved.session) return response.redirect().toRoute('sessions.index')

    let targets: TargetRow[] = []
    let error: string | null = null
    if (resolved.daemonDown) {
      error = `daemon down on :${resolved.session.daemonPort}`
    } else {
      try {
        targets = await listTargets(resolved.session.daemonPort, all)
      } catch (e) {
        error = (e as Error).message
      }
    }

    return inertia.render('sessions/targets', {
      id: resolved.session.id,
      all,
      error,
      session: {
        id: resolved.session.id,
        label: resolved.session.label,
        daemonPort: resolved.session.daemonPort,
        daemonUp: resolved.session.daemonUp,
      },
      targets,
    })
  }

  async store({ params, request, response }: HttpContext) {
    const id = String(params.id)
    const resolved = await sessionOrRedirect(id)
    if (!resolved.session?.daemonUp) {
      return response.redirect().toRoute('sessions.index')
    }
    const goal = String(request.input('goal') || '').trim()
    const deadlineRaw = String(request.input('deadline') || 'eod')
    const kind = (String(request.input('kind') || 'scope') as 'scope' | 'slice') || 'scope'
    const parentId = String(request.input('parentId') || '').trim() || undefined
    if (!goal) {
      return response.redirect().back()
    }
    try {
      await createTarget(resolved.session.daemonPort, {
        goal,
        deadlineAt: parseDeadline(deadlineRaw),
        kind,
        parentId,
      })
    } catch {
      /* flash later */
    }
    return response.redirect().toRoute('sessions.targets', { id: resolved.session.id })
  }

  async action({ params, response }: HttpContext) {
    const id = String(params.id)
    const targetId = String(params.targetId)
    const action = String(params.action) as 'done' | 'cancel' | 'triage' | 'remind'
    const resolved = await sessionOrRedirect(id)
    if (!resolved.session?.daemonUp) {
      return response.redirect().toRoute('sessions.index')
    }
    if (['done', 'cancel', 'triage', 'remind'].includes(action)) {
      try {
        await targetAction(resolved.session.daemonPort, targetId, action)
      } catch {
        /* ignore */
      }
    }
    return response.redirect().toRoute('sessions.targets', { id: resolved.session.id })
  }
}

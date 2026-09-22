import type { HttpContext } from '@adonisjs/core/http'
import { clearDaemonHealthCache } from '#services/session_registry'
import { resolveHubSession } from '#services/resolve_session'
import { killSession, listProfileFuncs, restartSessionInbox, runSessionFunc } from '#services/mesh_ops'

export default class SessionOpsController {
  async show({ inertia, params, response }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id))
    if (!resolved.session) return response.redirect().toRoute('sessions.index')
    const session = resolved.session

    let funcs: Array<{ id: string; command: string }> = []
    let funcsError: string | null = null
    try {
      funcs = listProfileFuncs(session.profilePath)
    } catch (e) {
      funcsError = e instanceof Error ? e.message : String(e)
    }

    return inertia.render('sessions/ops', {
      id: session.id,
      session: {
        id: session.id,
        label: session.label,
        sessionName: session.sessionName,
        workspace: session.workspace,
        profilePath: session.profilePath,
        daemonPort: session.daemonPort,
        daemonUp: session.daemonUp,
      },
      note: 'When inbox dies, agents fall back to bypass. Restart here from the hub — no CLI required. Run profile funcs the same way.',
      funcs,
      funcsError,
    })
  }

  async restartInbox({ params, request, response, session: httpSession }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id), { probe: false })
    if (!resolved.session) {
      httpSession.flash('error', 'Session not found')
      return response.redirect().toRoute('sessions.index')
    }
    const session = resolved.session

    const result = await restartSessionInbox(session.profilePath)
    clearDaemonHealthCache(session.daemonPort)
    const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 400)

    if (request.accepts(['json'])) {
      return response.status(result.code === 0 ? 200 : 422).json({
        ok: result.code === 0,
        sessionId: session.id,
        label: session.label,
        daemonPort: session.daemonPort,
        error: result.code === 0 ? undefined : detail || 'Restart failed',
      })
    }

    if (result.code === 0) {
      httpSession.flash(
        'success',
        `Inbox restarted for ${session.label} (:${session.daemonPort})`
      )
    } else {
      httpSession.flash('error', `Inbox restart failed: ${detail}`)
    }
    const returnTo = String(request.input('returnTo') || '').trim()
    if (returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      return response.redirect().toPath(returnTo)
    }
    return response.redirect().back()
  }

  async kill({ params, request, response, session: httpSession }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id), { probe: false })
    if (!resolved.session) {
      if (request.accepts(['html', 'json']) === 'json') {
        return response.status(404).json({ error: `session not found: ${params.id}` })
      }
      httpSession.flash('error', 'Session not found')
      return response.redirect().toRoute('sessions.index')
    }
    const session = resolved.session

    const result = await killSession(session.profilePath)
    clearDaemonHealthCache(session.daemonPort)
    const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 400)

    if (request.accepts(['html', 'json']) === 'json') {
      return response.status(result.code === 0 ? 200 : 422).json({
        ok: result.code === 0,
        sessionId: session.id,
        label: session.label,
        error: result.code === 0 ? undefined : detail || 'Kill failed',
      })
    }

    if (result.code === 0) {
      httpSession.flash('success', `Killed session ${session.label} (${session.sessionName})`)
    } else {
      httpSession.flash('error', `Kill failed: ${detail}`)
    }
    // Session is gone (or was already) — always land back on the list, never
    // its own now-dead detail/ops page.
    return response.redirect().toRoute('sessions.index')
  }

  async runFunc({ params, request, response, session: httpSession }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id), { probe: false })
    if (!resolved.session) {
      httpSession.flash('error', 'Session not found')
      return response.redirect().toRoute('sessions.index')
    }
    const session = resolved.session

    const body = request.body() as { funcId?: string; args?: string }
    const funcId = String(body.funcId ?? '').trim()
    const argLine = String(body.args ?? '').trim()
    const args = argLine ? argLine.split(/\s+/).filter(Boolean) : []

    if (!funcId) {
      httpSession.flash('error', 'func id required')
      return response.redirect().toPath(`/sessions/${session.id}/ops`)
    }

    const result = await runSessionFunc(session.profilePath, funcId, args)
    if (result.code === 0) {
      const out = (result.stdout || 'ok').trim().slice(0, 300)
      httpSession.flash('success', `func ${funcId}: ${out || 'ok'}`)
    } else {
      const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 400)
      httpSession.flash('error', `func ${funcId} failed: ${detail}`)
    }
    return response.redirect().toPath(`/sessions/${session.id}/ops`)
  }
}

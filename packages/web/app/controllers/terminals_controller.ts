import type { HttpContext } from '@adonisjs/core/http'
import { resolveHubSession } from '#services/resolve_session'
import { fetchPaneCapture, fetchPanes, sendPeerToPane } from '#services/daemon_panes'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

type AgentRow = {
  name: string
  type: string
  slot?: number | string | null
  ports?: string | null
  paneIndex?: number | null
  resumeId?: string | null
  kind: 'worker' | 'mini' | 'lead' | 'other'
}

function readAgents(workspace: string): { workers: AgentRow[]; minis: AgentRow[]; leads: AgentRow[] } {
  const file = join(workspace, '.sm', 'mesh-agents.json')
  if (!existsSync(file)) return { workers: [], minis: [], leads: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      workers?: Array<Record<string, unknown>>
      minis?: Array<Record<string, unknown>>
      manager?: Record<string, unknown>
      secretary?: Record<string, unknown>
    }
    const map = (row: Record<string, unknown>, kind: AgentRow['kind']): AgentRow => ({
      name: String(row.name ?? row.type ?? '?'),
      type: String(row.type ?? 'empty'),
      slot: (row.slot as number | string | null | undefined) ?? null,
      ports: (row.ports as string | null | undefined) ?? null,
      paneIndex: (row.paneIndex as number | null | undefined) ?? null,
      resumeId: (row.resumeId as string | null | undefined) ?? null,
      kind,
    })
    const workers = (raw.workers ?? []).map((r) => map(r, 'worker'))
    const minis = (raw.minis ?? []).map((r) => map(r, 'mini'))
    const leads: AgentRow[] = []
    if (raw.manager) leads.push(map({ ...raw.manager, name: 'manager' }, 'lead'))
    if (raw.secretary) leads.push(map({ ...raw.secretary, name: 'secretary' }, 'lead'))
    return { workers, minis, leads }
  } catch {
    return { workers: [], minis: [], leads: [] }
  }
}

export default class TerminalsController {
  async index({ inertia, params, response }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id))
    if (!resolved.session) return response.redirect().toRoute('sessions.index')
    const session = resolved.session

    const agents = readAgents(session.workspace)
    let panes: Awaited<ReturnType<typeof fetchPanes>>['panes'] = []
    let wsTmux = `ws://127.0.0.1:${session.daemonPort}/ws/tmux`
    let tmuxSession = session.sessionName
    let panesError: string | null = null

    if (session.daemonUp && session.daemonPort > 0) {
      try {
        const live = await fetchPanes(session.daemonPort)
        panes = live.panes
        wsTmux = live.wsTmux
        tmuxSession = live.session || tmuxSession
      } catch (e) {
        panesError = e instanceof Error ? e.message : String(e)
      }
    } else {
      panesError = 'Daemon down — start mesh inbox to use live terminals.'
    }

    return inertia.render('sessions/terminals', {
      id: session.id,
      session: {
        id: session.id,
        label: session.label,
        sessionName: session.sessionName,
        workspace: session.workspace,
        daemonPort: session.daemonPort,
        daemonUp: session.daemonUp,
      },
      note: 'Pane preview by default (safe). Live view is read-only + opt-in Connect. Send uses /to-peer inject.',
      agents,
      panes,
      wsTmux,
      tmuxSession,
      panesError,
    })
  }

  async capture({ params, request, response }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id), { probe: false })
    if (!resolved.session?.daemonPort) return response.notFound({ error: 'session' })
    const paneId = String(request.input('pane') ?? '')
    const pane = await fetchPaneCapture(resolved.session.daemonPort, paneId)
    if (!pane) return response.notFound({ error: 'pane' })
    return response.ok({ ok: true, pane })
  }

  async send({ params, request, response, session: httpSession }: HttpContext) {
    const resolved = await resolveHubSession(String(params.id), { probe: false })
    if (!resolved.session?.daemonPort) {
      httpSession.flash('error', 'Session daemon not found')
      return response.redirect().toPath(`/sessions/${params.id}/terminals`)
    }
    const session = resolved.session
    const body = request.body() as {
      msg?: string
      targetPane?: string
      targetLabel?: string
      kind?: string
    }
    const msg = String(body.msg ?? '').trim()
    const targetPane = String(body.targetPane ?? '').trim()
    if (!msg || !targetPane.startsWith('%')) {
      httpSession.flash('error', 'msg and targetPane (%N) required')
      return response.redirect().toPath(`/sessions/${session.id}/terminals`)
    }
    const result = await sendPeerToPane(session.daemonPort, {
      msg,
      targetPane,
      targetLabel: body.targetLabel,
      kind: body.kind,
    })
    if (!result.ok) {
      httpSession.flash('error', result.error || 'send failed')
    } else {
      httpSession.flash('success', `Sent to ${body.targetLabel || targetPane}`)
    }
    return response.redirect().toPath(`/sessions/${session.id}/terminals`)
  }
}

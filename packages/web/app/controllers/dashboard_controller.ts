import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HttpContext } from '@adonisjs/core/http'
import { aggregateStats, listHubSessions, type HubSession } from '#services/session_registry'

export type HubAlert = {
  severity: 'bad' | 'warn' | 'info'
  sessionId: string
  label: string
  text: string
  href: string
  /** Show inbox restart when daemon HTTP is down. */
  canRestart?: boolean
}

function seatmeshVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const rootPkg = join(here, '../../../../package.json')
    const pkg = JSON.parse(readFileSync(rootPkg, 'utf8')) as { version?: string }
    return pkg.version ?? 'dev'
  } catch {
    return 'dev'
  }
}

function buildAlerts(sessions: HubSession[]): HubAlert[] {
  const out: HubAlert[] = []
  for (const s of sessions) {
    if (!s.tmuxLive) {
      out.push({
        severity: 'bad',
        sessionId: s.id,
        label: s.label,
        text: 'tmux stopped',
        href: `/sessions/${s.id}`,
      })
    }
    if (s.daemonUp === false) {
      out.push({
        severity: 'bad',
        sessionId: s.id,
        label: s.label,
        text: `daemon down :${s.daemonPort}`,
        href: `/sessions/${s.id}/ops`,
        canRestart: true,
      })
    }
    if (s.health?.proxyDownActive) {
      out.push({
        severity: 'bad',
        sessionId: s.id,
        label: s.label,
        text: 'proxy / carrier down',
        href: `/sessions/${s.id}`,
      })
    }
    const peer = s.health?.peerUnsent ?? 0
    if (peer >= 5) {
      out.push({
        severity: 'warn',
        sessionId: s.id,
        label: s.label,
        text: `${peer} peer unsent`,
        href: `/sessions/${s.id}/queues`,
      })
    }
    const acks = s.health?.ackOpen ?? 0
    if (acks >= 10) {
      out.push({
        severity: 'warn',
        sessionId: s.id,
        label: s.label,
        text: `${acks} open ACKs`,
        href: `/sessions/${s.id}/queues`,
      })
    }
    const cbs = s.health?.checkbackActive ?? 0
    if (cbs >= 3) {
      out.push({
        severity: 'info',
        sessionId: s.id,
        label: s.label,
        text: `${cbs} checkbacks armed`,
        href: `/sessions/${s.id}/queues`,
      })
    }
  }
  return out
}

export default class DashboardController {
  async index({ inertia }: HttpContext) {
    const sessions = await listHubSessions({ probe: true })
    const stats = aggregateStats(sessions)
    const alerts = buildAlerts(sessions)
    return inertia.render('dashboard', {
      version: seatmeshVersion(),
      hubPort: Number(process.env.PORT || 3190),
      phase: '3 · terminals · act cards · tools',
      note: 'Live registry + health. Targets/queues/act cards via daemon HTTP. Set SEATMESH_HUB_URL for /ui → hub.',
      pollMs: 10000,
      stats: {
        ...stats,
        checkbacks: sessions.reduce((n, s) => n + (s.health?.checkbackActive ?? 0), 0),
        paneOps: sessions.reduce((n, s) => n + (s.health?.paneOpsPending ?? 0), 0),
      },
      alerts,
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        sessionName: s.sessionName,
        daemonPort: s.daemonPort,
        tmuxLive: s.tmuxLive,
        daemonUp: s.daemonUp,
        inboxReady: s.health?.ready ?? null,
        peerUnsent: s.health?.peerUnsent ?? null,
        ackOpen: s.health?.ackOpen ?? null,
        checkbackActive: s.health?.checkbackActive ?? null,
        proxyDown: s.health?.proxyDownActive ?? false,
      })),
    })
  }
}

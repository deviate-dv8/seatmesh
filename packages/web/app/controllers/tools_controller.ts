import { networkInterfaces } from 'node:os'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HttpContext } from '@adonisjs/core/http'
import { listHubSessions } from '#services/session_registry'

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

function lanIpv4(): string | null {
  const nets = networkInterfaces()
  for (const rows of Object.values(nets)) {
    for (const n of rows ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address
    }
  }
  return null
}

export default class ToolsController {
  async index({ inertia }: HttpContext) {
    const sessions = await listHubSessions({ probe: false })
    const hubPort = Number(process.env.PORT || 3190)
    const host = process.env.HOST || '127.0.0.1'
    const openLan = host === '0.0.0.0' || process.env.SEATMESH_HUB_OPEN === '1'
    const lan = lanIpv4()
    const phoneUrl = openLan && lan ? `http://${lan}:${hubPort}/` : null
    const qrUrl = phoneUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(phoneUrl)}`
      : null

    return inertia.render('tools/index', {
      version: seatmeshVersion(),
      hubPort,
      host,
      openLan,
      lanIp: lan,
      phoneUrl,
      qrUrl,
      note: 'QoL recipes — browser never raw tmux send-keys; mutations go through daemon HTTP / CLI.',
      recipes: [
        {
          title: 'Session Ops (restart + funcs)',
          cmd: 'http://127.0.0.1:3190/sessions/<id>/ops',
        },
        {
          title: 'Act cards (hub proxy)',
          cmd: 'http://127.0.0.1:3190/act/card/<id>?port=<daemon>',
        },
        {
          title: 'Open hub on LAN (phone QR)',
          cmd: 'HOST=0.0.0.0 SEATMESH_HUB_OPEN=1 npm run web   # then scan QR below',
        },
        {
          title: 'Inbox restart (CLI)',
          cmd: 'seatmesh inbox restart',
        },
        {
          title: 'Hub → /ui + act cards',
          cmd: 'export SEATMESH_HUB_URL=http://127.0.0.1:3190   # then inbox restart',
        },
      ],
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        daemonPort: s.daemonPort,
        daemonUp: s.daemonUp,
      })),
    })
  }
}

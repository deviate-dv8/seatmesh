import fs from 'node:fs'
import type { HttpContext } from '@adonisjs/core/http'
import {
  loadProfile,
  profileToFormValues,
  writeProfileFormPatch,
  type ProfileFormPatch,
} from '@seat-mesh/core'
import { findHubSession, listHubSessions } from '#services/session_registry'

export default class ConfigController {
  async show({ inertia, params, response }: HttpContext) {
    const sessions = await listHubSessions({ probe: false })
    const session = findHubSession(String(params.id), sessions)
    if (!session) return response.redirect().toRoute('sessions.index')

    let form: ProfileFormPatch | null = null
    let rawYaml = ''
    let error: string | null = null
    try {
      const loaded = loadProfile(session.profilePath)
      form = profileToFormValues(loaded.profile as unknown as Record<string, unknown>)
      rawYaml = fs.readFileSync(loaded.profilePath, 'utf8')
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    return inertia.render('sessions/config', {
      id: session.id,
      session: {
        id: session.id,
        label: session.label,
        profilePath: session.profilePath,
        workspace: session.workspace,
        daemonPort: session.daemonPort,
      },
      note: 'Edit mesh.config.yaml via FormKit. Save validates with MeshProfileSchema. Agents: seatmesh agent config check after hand-edits.',
      form,
      rawYaml,
      error,
    })
  }

  async update({ params, request, response, session: httpSession }: HttpContext) {
    const sessions = await listHubSessions({ probe: false })
    const session = findHubSession(String(params.id), sessions)
    if (!session) {
      httpSession.flash('error', 'Session not found')
      return response.redirect().toRoute('sessions.index')
    }

    const body = request.body() as ProfileFormPatch & { form?: ProfileFormPatch }
    // FormKit / inertia may nest under `form` or send flat
    const patch: ProfileFormPatch = body.form ?? body

    try {
      const result = writeProfileFormPatch(session.profilePath, {
        name: patch.name,
        session: patch.session,
        daemon: patch.daemon,
        ports: patch.ports,
        layout: patch.layout,
      })
      httpSession.flash(
        'success',
        `Saved ${session.profilePath} (backup ${result.backupPath.split('/').pop()})`
      )
    } catch (e) {
      httpSession.flash('error', e instanceof Error ? e.message : String(e))
    }
    return response.redirect().toPath(`/sessions/${session.id}/config`)
  }
}

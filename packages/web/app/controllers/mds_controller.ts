import type { HttpContext } from '@adonisjs/core/http'

export default class MdsController {
  async index({ inertia }: HttpContext) {
    return inertia.render('mds/index', {
      note: 'Act cards on hub render GFM + mermaid. Hosted mdview gallery still via `seatmesh agent preview`.',
      items: [] as Array<{ title: string; url: string; when: string }>,
    })
  }
}

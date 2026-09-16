import { defineNavBlock, Trait } from 'waygraph'
import { SessionId } from '../../../../../states/hub.mem-keys.js'
import type { SessionConfigPage } from '../../../../../states/hub.states.js'

export const NavSessionConfigBlock = defineNavBlock<SessionConfigPage>({
  name: 'nav-session-config',
  description: 'Session config page (FormKit + raw YAML tabs)',
  checkpoint: 'SessionConfigPage',
  requires: [SessionId],
  url: (mem) => `/sessions/${mem.get(SessionId)}/config`,
  verify: [
    Trait.url({ pathname: '/sessions/:id/config' }),
    Trait.text('h1', 'Config'),
    Trait.visible('.formkit-form'),
  ],
})
